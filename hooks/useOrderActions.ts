'use client';

/**
 * Shared hook for order action state + handlers.
 * Uses optimistic updates: UI reflects the new state immediately,
 * and reverts only if the API call fails.
 */

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/formatters';
import { orderLatLng } from '@/lib/maps';
import { ACTIVE_DELIVERY_KEY } from '@/lib/constants';
import {
    settleOrderPayment,
    fetchOrderFulfillmentDetail,
    startOrderOutForDelivery,
    type DeliveryOrder,
} from '@/services/orders.service';

interface UseOrderActionsOptions {
    order: DeliveryOrder;
    channelToken: string | null;
    isDeliveryPerson: boolean;
    onOrderUpdated: (orderId: string, newState: string) => void;
}

export function useOrderActions({ order, channelToken, isDeliveryPerson, onOrderUpdated }: UseOrderActionsOptions) {
    const [settling, setSettling] = useState(false);
    const [settleError, setSettleError] = useState('');
    const [fulfillModalOpen, setFulfillModalOpen] = useState(false);
    const [transitioning, setTransitioning] = useState(false);
    const [transitionError, setTransitionError] = useState('');
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [paymentFulfillmentId, setPaymentFulfillmentId] = useState<string | null>(null);

    const router = useRouter();

    // In-flight guard — prevents a second mutation call if the button is double-clicked
    const inFlight = useRef(false);

    // ── Derived values ────────────────────────────────────────────────
    const customerName = order.customer
        ? `${order.customer.firstName} ${order.customer.lastName}`
        : '—';
    const total = formatCurrency(order.totalWithTax, order.currencyCode);
    const invoiceNo = order.customFields?.invoiceNo;

    // ── Permission checks ─────────────────────────────────────────────
    const canSettle = !isDeliveryPerson && order.state === 'PaymentAuthorized';

    const stateLC = order.state?.toLowerCase() ?? '';
    // If fulfillments exist but ALL are Cancelled, the order needs re-fulfillment
    const allFulfillmentsCancelled =
        !!(order.fulfillments?.length) &&
        order.fulfillments.every((f) => f.state === 'Cancelled');
    // Mismatch scenario: fulfillment already OutforDelivery but order state still Shipped
    const hasOutforDeliveryFulfillment =
        order.fulfillments?.some((f) => f.state === 'OutforDelivery') ?? false;

    // Fulfill: PaymentSettled (normal) OR Shipped with all fulfillments cancelled (re-fulfil)
    const canFulfill = !isDeliveryPerson && (
        order.state === 'PaymentSettled' ||
        (stateLC === 'shipped' && allFulfillmentsCancelled)
    );
    // Out for Delivery: Shipped + active fulfillment + not already OutforDelivery in fulfillment
    const canOutForDelivery = stateLC === 'shipped' && !allFulfillmentsCancelled && !hasOutforDeliveryFulfillment;
    // Deliver: normal OutforDelivery order OR stuck Shipped order whose fulfillment is already OutforDelivery
    const canDeliver = stateLC === 'outfordelivery' || (stateLC === 'shipped' && hasOutforDeliveryFulfillment);

    // ── Action handlers (optimistic updates) ───────────────────────────

    async function handleSettle() {
        if (inFlight.current) return;
        inFlight.current = true;
        setSettling(true);
        setSettleError('');

        // Optimistic: update UI immediately
        const prevState = order.state;
        onOrderUpdated(order.id, 'PaymentSettled');

        try {
            await settleOrderPayment(order.id, channelToken ?? undefined);
        } catch (err) {
            // Revert on failure
            onOrderUpdated(order.id, prevState);
            setSettleError(err instanceof Error ? err.message : 'Failed to settle payment');
        } finally {
            setSettling(false);
            inFlight.current = false;
        }
    }

    /**
     * Legacy direct transition (optimistic + revert) — used only for orders
     * WITHOUT map coordinates; everything else goes through /delivery/[id].
     */
    async function startOutForDelivery() {
        if (inFlight.current) return;
        inFlight.current = true;
        setTransitioning(true);
        setTransitionError('');

        // Optimistic: update UI immediately
        const prevState = order.state;
        onOrderUpdated(order.id, 'OutforDelivery');

        try {
            await startOrderOutForDelivery(order, channelToken ?? undefined);
        } catch (err) {
            // Revert on failure
            onOrderUpdated(order.id, prevState);
            setTransitionError(err instanceof Error ? err.message : 'Transition failed');
        } finally {
            setTransitioning(false);
            inFlight.current = false;
        }
    }

    /**
     * "Out for Delivery" button tap. Does NOT change state:
     *   · another delivery already active → refuse (one at a time)
     *   · order has coordinates → NAVIGATE to the delivery tracking page
     *     (the state changes there, on Start)
     *   · no coordinates → legacy direct transition, exactly as before
     */
    function handleOutForDelivery() {
        if (inFlight.current) return;

        const activeId = typeof window !== 'undefined'
            ? localStorage.getItem(ACTIVE_DELIVERY_KEY)
            : null;
        if (activeId && activeId !== order.id) {
            setTransitionError('Finish your active delivery first');
            return;
        }

        if (!orderLatLng(order.shippingAddress)) {
            console.warn(`[map] Order ${order.code} has no shipping coordinates — starting without map`);
            void startOutForDelivery();
            return;
        }

        setTransitionError('');
        router.push(`/delivery/${order.id}`);
    }

    async function handleDeliver() {
        if (inFlight.current) return;
        setTransitionError('');

        // Side door closed: for delivery persons, a mappable order that is out
        // for delivery is delivered THROUGH the tracking page (map → Delivered
        // button there) so the ride, odometer, and resume flow stay truthful.
        // Orders without coordinates keep the direct modal, as does admin use.
        if (isDeliveryPerson && orderLatLng(order.shippingAddress)) {
            router.push(`/delivery/${order.id}`);
            return;
        }

        // Find the active fulfillment ID first
        let fulfillmentId = order.fulfillments?.find((f) => f.state === 'OutforDelivery')?.id;
        if (!fulfillmentId) {
            try {
                const detail = await fetchOrderFulfillmentDetail(order.id, channelToken ?? undefined);
                fulfillmentId = detail.fulfillments?.find((f) => f.state === 'OutforDelivery')?.id
                    ?? detail.fulfillments?.find((f) => f.state !== 'Cancelled')?.id;
            } catch {
                setTransitionError('Failed to fetch fulfillment details');
                return;
            }
        }
        if (!fulfillmentId) {
            setTransitionError('No active fulfillment found for this order');
            return;
        }

        // Always open the bottom sheet — it handles both online (Bill Paid) and COD flows
        setPaymentFulfillmentId(fulfillmentId);
        setPaymentModalOpen(true);
    }

    return {
        // State
        settling,
        settleError,
        fulfillModalOpen,
        setFulfillModalOpen,
        transitioning,
        transitionError,
        paymentModalOpen,
        setPaymentModalOpen,
        paymentFulfillmentId,
        // Derived
        customerName,
        total,
        invoiceNo,
        // Permissions
        canSettle,
        canFulfill,
        canOutForDelivery,
        canDeliver,
        // Handlers
        handleSettle,
        handleOutForDelivery,
        handleDeliver,
    };
}
