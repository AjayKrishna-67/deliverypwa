'use client';

/**
 * DashboardLayout — responsive layout with collapsible sidebar.
 * Mobile (< md): hamburger opens a drawer overlay (always expanded).
 * Desktop (≥ md): sidebar toggles between expanded (220px) and collapsed (60px, icons only).
 */

import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { Sidebar, type SidebarChannel } from '@/components/layout/Sidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { LocationGate } from '@/components/location/LocationGate';
import { GpsRequiredGate } from '@/components/location/GpsRequiredGate';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { ACTIVE_DELIVERY_KEY } from '@/lib/constants';
import { isDeliveryPersonUser } from '@/lib/roles';
import { fetchActiveRideForMe } from '@/services/tracking.service';
import { seedOdometerMeters } from '@/lib/odometer';
import { GoodsTransferAlertWatcher } from '@/components/goods-transfer/GoodsTransferAlertWatcher';
import {
    ChannelSwitchGuardContext,
    type ChannelSwitchGuard,
    type ChannelSwitchGuardApi,
} from '@/components/layout/channel-switch-guard';

export interface DashboardLayoutChildProps {
    selectedChannelId: string | null;
    selectedChannel: SidebarChannel | null;
    channelToken: string | null;
    channelPermissions: string[];
    onMenuToggle: () => void;
    onLogout: () => void;
}

interface DashboardLayoutProps {
    children: (props: DashboardLayoutChildProps) => ReactNode;
    hideHeader?: boolean;
}

export function DashboardLayout({ children, hideHeader }: DashboardLayoutProps) {
    const { logout, administrator, currentUser } = useAuth();
    const router = useRouter();

    const channels: SidebarChannel[] = useMemo(() => {
        if (!currentUser?.channels) return [];
        return currentUser.channels
            .filter((ch) => ch.code !== '__default_channel__')
            .map((ch) => ({ id: ch.id, code: ch.code, token: ch.token }));
    }, [currentUser]);

    // Only the user's chosen id is state (lazily restored from localStorage —
    // same pattern as sidebarCollapsed below); the channel object is derived,
    // so no restore effect is needed.
    const [selectedChannelId, setSelectedChannelId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('selected-channel-id');
    });

    const selectedChannel: SidebarChannel | null = useMemo(() => {
        if (channels.length === 0) return null;
        return channels.find((c) => c.id === selectedChannelId) ?? channels[0];
    }, [channels, selectedChannelId]);

    // Mobile drawer state
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Desktop collapsed state — persisted in localStorage
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem('sidebar-collapsed') === '1';
    });

    function toggleCollapse() {
        setSidebarCollapsed((v) => {
            const next = !v;
            localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
            return next;
        });
    }

    // Resume an in-progress delivery — two tiers:
    //   1. localStorage flag (instant, no network) — same-device refresh.
    //   2. Backend `activeRideForMe` (open DeliveryRide row) — survives
    //      logout, app kill, reinstall, even a different phone. The backend
    //      opens the ride on the OutforDelivery transition, so it can't be
    //      erased client-side.
    // The /delivery page self-heals stale state — terminal or inaccessible
    // orders clear the flag and exit — so neither tier can loop.
    const rideCheckDone = useRef(false);
    useEffect(() => {
        try {
            const activeId = localStorage.getItem(ACTIVE_DELIVERY_KEY);
            if (activeId) {
                router.replace(`/delivery/${activeId}`);
                return;
            }
        } catch {
            // storage blocked — fall through to the backend check
        }
        // Backend fallback — once per mount, delivery persons only
        if (rideCheckDone.current || !isDeliveryPersonUser(currentUser)) return;
        rideCheckDone.current = true;
        let cancelled = false;
        fetchActiveRideForMe(selectedChannel?.token ?? undefined)
            .then((ride) => {
                if (cancelled || !ride) return;
                // Loop breaker: if we already redirected to this order once
                // this session and the delivery page sent us back (terminal /
                // inaccessible order), do NOT redirect again — one bounce is
                // information, a second is an infinite loop. The backend also
                // self-heals stale rides; this guard covers the gap until it
                // does (and any cause we haven't foreseen).
                const attemptedKey = `resume-attempted:${ride.orderId}`;
                try {
                    if (sessionStorage.getItem(attemptedKey)) return;
                    sessionStorage.setItem(attemptedKey, '1');
                } catch { /* storage blocked — proceed without the guard */ }
                try {
                    localStorage.setItem(ACTIVE_DELIVERY_KEY, ride.orderId);
                } catch { /* non-critical */ }
                // Logout wiped the local odometer — continue counting from the
                // backend's stored km so post-resume distance still registers
                seedOdometerMeters(ride.orderId, ride.distanceMeters);
                router.replace(`/delivery/${ride.orderId}`);
            })
            .catch(() => {
                // Offline / API unavailable — the driver just lands on the
                // orders list, and the OutforDelivery order is still there.
            });
        return () => { cancelled = true; };
    }, [router, currentUser, selectedChannel]);

    // Close mobile drawer on resize to desktop
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const handler = (e: MediaQueryListEvent) => { if (e.matches) setSidebarOpen(false); };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    async function handleLogout() {
        await logout();
        router.replace('/login');
    }

    /**
     * Whatever screen is on show may veto a branch change — see channel-switch-guard.
     *
     * Asked BEFORE anything is written, because switching branch does not remount
     * what is on screen: a screen holding a half-built request would otherwise keep
     * its rows while the branch beneath them changed, and only find out afterwards.
     * Nothing registers a guard on most screens, so the common case answers true
     * without a render.
     */
    const guardRef = useRef<ChannelSwitchGuard | null>(null);
    // Stable, so registering never re-renders anything below it.
    const guardApi = useMemo<ChannelSwitchGuardApi>(
        () => ({
            setGuard: (guard) => {
                guardRef.current = guard;
            },
        }),
        [],
    );

    async function handleChannelSelect(ch: SidebarChannel) {
        if (ch.id === selectedChannelId) {
            return;
        }
        // Closed first: on a phone the sidebar covers the screen, and a question
        // asked underneath it cannot be read or answered.
        setSidebarOpen(false);
        if (guardRef.current && !(await guardRef.current())) {
            return;
        }
        setSelectedChannelId(ch.id);
        if (typeof window !== 'undefined') {
            localStorage.setItem('selected-channel-id', ch.id);
        }
    }

    const channelToken = selectedChannel?.token ?? null;

    const channelPermissions: string[] = useMemo(() => {
        if (!selectedChannel || !currentUser?.channels) return [];
        const matched = currentUser.channels.find((ch) => ch.id === selectedChannel.id);
        return (matched?.permissions as string[]) ?? [];
    }, [selectedChannel, currentUser]);

    return (
        <div
            className="flex h-[100dvh] overflow-hidden"
            style={{ background: 'var(--background)' }}
        >
            {/*
              Goods Transfer alerts and push, for every signed-in screen rather than
              only inside that section — a branch manager should be told what the
              other branch did wherever they are standing, and should be subscribed
              to push from the moment they sign in. Draws nothing, and does nothing
              at all for an account without Goods Transfer permission.
            */}
            <GoodsTransferAlertWatcher channelToken={channelToken} />

            {/* ── Mobile backdrop ── */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* ── Sidebar ──
                Desktop: always visible, toggles collapsed/expanded
                Mobile: fixed drawer, always expanded when open */}
            <div
                className={`
                    fixed inset-y-0 left-0 z-40 transition-all duration-300 ease-in-out
                    md:relative md:translate-x-0 md:z-auto md:flex md:flex-col
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                `}
            >
                <Sidebar
                    channels={channels}
                    selectedChannelId={selectedChannel?.id ?? null}
                    onChannelSelect={handleChannelSelect}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={toggleCollapse}
                />
            </div>

            {/* ── Main area ── */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                {!hideHeader && (
                    <DashboardHeader
                        administrator={administrator}
                        onLogout={handleLogout}
                        selectedChannel={selectedChannel}
                        onMenuToggle={() => setSidebarOpen((v) => !v)}
                    />
                )}

                <main className="flex-1 overflow-y-auto overflow-x-hidden">
                    {/* COMPULSORY fullscreen GPS blocker for delivery accounts —
                        covers the whole app until location is granted */}
                    <GpsRequiredGate />
                    <PullToRefresh />
                    {/* Optional GPS card/banner for everyone else (admins) */}
                    <LocationGate />
                    <ChannelSwitchGuardContext.Provider value={guardApi}>
                        {children({
                            selectedChannelId: selectedChannel?.id ?? null,
                            selectedChannel,
                            channelToken,
                            channelPermissions,
                            onMenuToggle: () => setSidebarOpen((v) => !v),
                            onLogout: handleLogout,
                        })}
                    </ChannelSwitchGuardContext.Provider>
                </main>
            </div>
        </div>
    );
}
