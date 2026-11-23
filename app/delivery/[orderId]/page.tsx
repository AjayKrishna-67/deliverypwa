'use client';

/**
 * /delivery/[orderId] — the delivery tracking PAGE (full screen in the app).
 *
 * Owns the order state for the whole delivery flow:
 *   · fetches the order by id and POLLS it every 15 s, so changes made
 *     elsewhere (admin cancels or delivers) release the driver instead of
 *     trapping them — any terminal state exits back to /orders
 *   · derives the phase from the ORDER STATE, so a refresh or app restart
 *     lands back in the right phase automatically (no client-side guessing)
 *   · Start runs the real OutforDelivery transition and writes the
 *     active-delivery flag (one delivery at a time + login recovery)
 *   · Delivered opens the existing PaymentCollectionModal; when the order
 *     reaches Delivered the flag is cleared and the page exits
 *
 * Cold entry (typed URL, stale recovery flag) is safe: orders that are not
 * found, not accessible, or not in a startable state show a message with a
 * way back — tapping it clears a stale flag so recovery can't loop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { DeliveryMapView } from '@/components/orders/DeliveryMapView';
import { PaymentCollectionModal } from '@/components/orders/PaymentCollectionModal';
import { ModalPortal } from '@/components/orders/ModalPortal';
import { ACTIVE_DELIVERY_KEY } from '@/lib/constants';
import { orderLatLng } from '@/lib/maps';
import { clearOdometer, readOdometerMeters } from '@/lib/odometer';
import {
    fetchOrderFullDetail,
    toDeliveryOrder,
    startOrderOutForDelivery,
    type DeliveryOrder,
} from '@/services/orders.service';
import { completeDeliveryRide, startDeliveryRide } from '@/services/tracking.service';
import { useRideSocket } from '@/hooks/useRideSocket';
import { useDriverLocation } from '@/providers/DriverLocationProvider';

const ORDER_POLL_MS = 15_000;

/** A GPS fix older than this doesn't count as "live" — the enforcement below
 *  re-evaluates every few seconds, so turning GPS off blocks within ~35 s. */
const GPS_FRESH_MS = 30_000;

export default function DeliveryPage() {
    const { isLoading, isAuthenticated } = useRequireAuth();

    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    return <DeliveryPageContent />;
}

function DeliveryPageContent() {
    const { orderId } = useParams<{ orderId: string }>();
    const router = useRouter();
    const { currentUser } = useAuth();

    // Channel token — same restore logic as DashboardLayout (this page is a
    // focused full screen without the sidebar, so it derives its own)
    const channelToken = useMemo(() => {
        const channels = currentUser?.channels?.filter((c) => c.code !== '__default_channel__') ?? [];
        if (channels.length === 0) return null;
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected-channel-id') : null;
        return (channels.find((c) => c.id === savedId) ?? channels[0]).token ?? null;
    }, [currentUser]);

    const [order, setOrder] = useState<DeliveryOrder | null>(null);
    const [loadError, setLoadError] = useState('');
    const [paymentOpen, setPaymentOpen] = useState(false);
    const exitingRef = useRef(false);

    // ── GPS enforcement: no Start, no Delivered without a LIVE fix ────
    // Policy: mapped deliveries require GPS ON, start to finish. (Orders
    // without map coordinates never reach this page — their delivery is
    // closed from the orders list, which stays unrestricted.) Permission
    // alone is not enough — the device's location toggle turning off stops
    // fixes silently, so "live" means a fix fresher than GPS_FRESH_MS,
    // re-checked on a 5 s tick.
    const { status: gpsStatus, position: gpsPosition, fixIssue } = useDriverLocation();
    const [gpsTick, setGpsTick] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setGpsTick(Date.now()), 5_000);
        return () => clearInterval(t);
    }, []);
    // A fix from 20 s ago doesn't count if the phone's Location switch has
    // been turned off since — Android reports that within seconds in the
    // app shell (browsers stay soft on a code-2 blip, per the gate's policy)
    const gpsLive =
        gpsStatus === 'granted' &&
        !!gpsPosition &&
        gpsTick - gpsPosition.timestamp < GPS_FRESH_MS &&
        !(fixIssue?.kind === 'unavailable' && fixIssue.source === 'native');

    const load = useCallback(async () => {
        try {
            const detail = await fetchOrderFullDetail(orderId, channelToken ?? undefined);
            setOrder(toDeliveryOrder(detail));
            setLoadError('');
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : 'Failed to load the order');
        }
    }, [orderId, channelToken]);

    // Initial load + poll — external cancels/delivers release the page.
    // (The first fetch runs from a 0ms timer so all setState stays inside
    // async callbacks, per the effect rules.)
    useEffect(() => {
        const t0 = setTimeout(load, 0);
        const t = setInterval(load, ORDER_POLL_MS);
        return () => {
            clearTimeout(t0);
            clearInterval(t);
        };
    }, [load]);

    // ── Derivations: phase & terminal, straight from the order state ──
    const stateLC = order?.state?.toLowerCase() ?? '';
    const hasOfdFulfillment = order?.fulfillments?.some((f) => f.state === 'OutforDelivery') ?? false;
    const phase: 'preview' | 'active' =
        stateLC === 'outfordelivery' || hasOfdFulfillment ? 'active' : 'preview';
    const terminal = stateLC === 'delivered' || stateLC === 'cancelled';
    // Startable: Shipped (normal preview) or already active (refresh mid-delivery)
    const startable = stateLC === 'shipped' || phase === 'active';

    // Live position stream to the fleet page — one ride-fix every ~2.5 s over
    // the socket while the ride is active (HTTP heartbeats pause meanwhile)
    useRideSocket(phase === 'active' && !terminal, order?.id ?? null, channelToken);

    // Exit on any terminal state — delivered here, delivered elsewhere, or
    // cancelled by an admin. Clears the active-delivery flag either way.
    useEffect(() => {
        if (!order || !terminal || exitingRef.current) return;
        exitingRef.current = true;
        try {
            if (localStorage.getItem(ACTIVE_DELIVERY_KEY) === order.id) {
                localStorage.removeItem(ACTIVE_DELIVERY_KEY);
            }
        } catch { /* storage blocked — non-critical */ }
        clearOdometer(order.id);
        router.replace('/orders');
    }, [order, terminal, router]);

    // ── Actions ───────────────────────────────────────────────────────
    async function handleStart() {
        if (!order) return;
        if (!gpsLive) return; // GPS mandatory — the banner explains why nothing happened
        await startOrderOutForDelivery(order, channelToken ?? undefined);
        try {
            localStorage.setItem(ACTIVE_DELIVERY_KEY, order.id);
        } catch { /* non-critical */ }
        // Open the backend DeliveryRide (idempotent; the fulfillment event
        // also opens it server-side — this is the fast path, not the only one)
        void startDeliveryRide(order.id, channelToken ?? undefined).catch(() => {});
        // Optimistic: phase derives from state; the next poll confirms
        setOrder((prev) => (prev ? { ...prev, state: 'OutforDelivery' } : prev));
    }

    const activeFulfillmentId =
        order?.fulfillments?.find((f) => f.state === 'OutforDelivery')?.id
        ?? order?.fulfillments?.find((f) => f.state !== 'Cancelled')?.id
        ?? null;

    function handleDelivered(id: string, newState: string) {
        // Close the backend ride with the final odometer reading. Best-effort:
        // the fulfillment Delivered event also closes it server-side; this
        // call is what carries the km. Runs before the terminal effect wipes
        // the odometer.
        if (order) {
            void completeDeliveryRide(
                order.id,
                readOdometerMeters(order.id),
                channelToken ?? undefined,
            ).catch(() => {});
        }
        // Order state flip → the terminal effect above clears the flag and exits
        setOrder((prev) => (prev ? { ...prev, state: newState } : prev));
    }

    /** Leave via the error/not-ready screens — clears a stale recovery flag
     *  pointing at THIS order so the login redirect can't loop back here. */
    function backToOrders() {
        try {
            if (localStorage.getItem(ACTIVE_DELIVERY_KEY) === orderId) {
                localStorage.removeItem(ACTIVE_DELIVERY_KEY);
            }
        } catch { /* non-critical */ }
        router.replace('/orders');
    }

    // ── Render ────────────────────────────────────────────────────────
    if (loadError && !order) {
        return (
            <FullScreenMessage
                emoji="⚠️"
                title="Could not open this delivery"
                body={loadError}
                actionLabel="Back to orders"
                onAction={backToOrders}
            />
        );
    }
    if (!order || terminal) return <LoadingScreen />;

    if (!startable) {
        return (
            <FullScreenMessage
                emoji="📦"
                title="This order is not ready for delivery"
                body={`Order ${order.code} is in "${order.state}" state — it must be fulfilled (Shipped) before starting a delivery.`}
                actionLabel="Back to orders"
                onAction={backToOrders}
            />
        );
    }
    if (!orderLatLng(order.shippingAddress)) {
        return (
            <FullScreenMessage
                emoji="🗺️"
                title="No location on this address"
                body="This order's address has no map coordinates, so the delivery map is unavailable. Use the buttons on the orders list instead."
                actionLabel="Back to orders"
                onAction={backToOrders}
            />
        );
    }

    return (
        <>
            {/* GPS banner. Before Start (preview) it BLOCKS — no ride without
                GPS. Mid-ride it's a warning only: Delivered always works, so a
                dead sensor can never trap a payment at the customer's door. */}
            {!gpsLive && (
                <div
                    className="fixed top-0 inset-x-0 z-[95] flex items-center justify-center gap-2 px-4 py-3 text-[0.8125rem] font-semibold text-white"
                    style={{
                        background: phase === 'preview' ? 'rgba(220,38,38,0.95)' : 'rgba(245,158,11,0.95)',
                        backdropFilter: 'blur(4px)',
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="10" r="3" />
                        <path d="M12 2a8 8 0 00-8 8c0 5.4 7.05 11.5 7.35 11.76a1 1 0 001.3 0C13 21.5 20 15.4 20 10a8 8 0 00-8-8z" />
                        <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" />
                    </svg>
                    {/* One line at 360 px — the banner sits over the map header */}
                    {gpsStatus !== 'granted'
                        ? 'Location permission needed to start'
                        : phase === 'preview'
                          ? fixIssue?.kind === 'unavailable'
                              ? 'Phone Location is off — turn it on'
                              : gpsPosition
                                ? 'GPS signal lost — waiting for a fix'
                                : 'Waiting for GPS to start'
                          : 'GPS off — tracking paused, Delivered still works'}
                </div>
            )}
            {paymentOpen && activeFulfillmentId && (
                <ModalPortal>
                    <PaymentCollectionModal
                        order={order}
                        fulfillmentId={activeFulfillmentId}
                        channelToken={channelToken}
                        onDelivered={handleDelivered}
                        onClose={() => setPaymentOpen(false)}
                    />
                </ModalPortal>
            )}
            <DeliveryMapView
                gpsLive={gpsLive}
                order={order}
                phase={phase}
                onStart={handleStart}
                onDeliver={() => activeFulfillmentId && setPaymentOpen(true)}
                onBack={backToOrders}
            />
        </>
    );
}

// ─── Full-screen info/error screen ───────────────────────────────────

function FullScreenMessage({
    emoji,
    title,
    body,
    actionLabel,
    onAction,
}: {
    emoji: string;
    title: string;
    body: string;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <div
            className="flex flex-col items-center justify-center h-dvh w-full gap-4 p-6 text-center"
            style={{ background: 'var(--background)' }}
        >
            <span className="text-5xl leading-none" aria-hidden>{emoji}</span>
            <h1 className="text-[1.125rem] font-bold text-[var(--foreground)]">{title}</h1>
            <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)] max-w-sm">{body}</p>
            <button
                onClick={onAction}
                className="mt-2 px-6 py-3 rounded-xl text-[0.875rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors"
            >
                {actionLabel}
            </button>
        </div>
    );
}
