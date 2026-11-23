'use client';

/**
 * /fleet — delivery-fleet monitoring for admins, filtered by day.
 *
 * Date picker in the header (IST day, default today, kept in ?date=). The
 * list shows the delivery persons who CLOSED at least one order that day
 * (`deliveryReport`), with their delivered count and km. Today also gets the
 * live layer: map of active + out-for-delivery drivers, state badge, current
 * order, last seen and Locate — fed by `driverStatuses` (socket pushes, 10 s
 * poll fallback; state is derived server-side: open ride ⇒ Out for delivery;
 * fresh heartbeat with GPS on ⇒ Active; silence ⇒ Inactive). Row tap →
 * /fleet/[adminId]?date=… for that day's delivered and assigned orders.
 *
 * UX-gated to admins (ViewDeliveryReports / CustomFulfillment); the backend
 * resolver enforces the real permissions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FleetMap } from '@/components/fleet/FleetMap';
import { useFleetSocket } from '@/hooks/useFleetSocket';
import { hasPermissionAnyChannel } from '@/lib/is-superadmin';
import { formatDistance } from '@/lib/maps';
import {
    dayDeliverers,
    formatDayLabel,
    istDayBounds,
    metersStartedIn,
    parseDayParam,
    todayIst,
    type FleetDayRow,
} from '@/lib/fleet-day';
import { fetchDeliveryReport, type DeliveryPersonSummary } from '@/services/reports.service';
import {
    fetchDriverRides,
    fetchDriverStatuses,
    type DriverFleetStatus,
    type DriverFleetState,
} from '@/services/tracking.service';

const FLEET_POLL_MS = 10_000;
/** Today's delivered list re-polls so new deliveries appear — the report is
 *  cached server-side and flushed on every delivery, so this is cheap. */
const DAY_POLL_MS = 30_000;

// ─── State badge config ──────────────────────────────────────────────

const STATE_BADGES: Record<DriverFleetState, { label: string; color: string; bg: string; border: string }> = {
    OUT_FOR_DELIVERY: { label: 'Out for Delivery', color: 'var(--tone-teal-deep)', bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)' },
    ACTIVE: { label: 'Active', color: 'var(--tone-green-deep)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
    INACTIVE: { label: 'Inactive', color: 'var(--tone-slate)', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)' },
};

function StateBadge({ state }: { state: DriverFleetState }) {
    const cfg = STATE_BADGES[state] ?? STATE_BADGES.INACTIVE;
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold whitespace-nowrap"
            style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
            {cfg.label}
        </span>
    );
}

/** `onLocate` gets the click time — FleetMap re-pans on every fresh focus ts. */
function LocateButton({ name, onLocate }: { name: string; onLocate: (ts: number) => void }) {
    return (
        <button
            onClick={(e) => {
                // Row click navigates to the day's orders — keep this to the map
                e.stopPropagation();
                onLocate(Date.now());
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.6875rem] font-semibold shrink-0 cursor-pointer transition-colors"
            style={{ color: 'var(--tone-teal-deep)', background: 'rgba(20,184,166,0.12)', border: '1px solid rgba(20,184,166,0.35)' }}
            title={`Show ${name} on the map`}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            Locate
        </button>
    );
}

function lastSeenLabel(iso: string | null): string {
    if (!iso) return 'never';
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function FleetPage() {
    const { isLoading, isAuthenticated } = useRequireAuth();

    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    return (
        <DashboardLayout>
            {({ channelToken }) => <FleetContent channelToken={channelToken} />}
        </DashboardLayout>
    );
}

function FleetContent({ channelToken }: { channelToken: string | null }) {
    const router = useRouter();
    const { currentUser } = useAuth();
    const allowed = useMemo(
        () =>
            hasPermissionAnyChannel(currentUser, 'ViewDeliveryReports') ||
            hasPermissionAnyChannel(currentUser, 'CustomFulfillment'),
        [currentUser],
    );

    // Staleness and "today" are time-derived; re-derive every 10 s.
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNowMs(Date.now()), 10_000);
        return () => clearInterval(t);
    }, []);
    const today = todayIst(new Date(nowMs));

    // The day filter, kept in ?date= so the detail page's back link returns
    // to the same day. window.location instead of useSearchParams() — avoids
    // the Suspense boundary Next requires for it in prerendered client pages.
    const [day, setDay] = useState(() =>
        parseDayParam(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('date')),
    );
    const isToday = day === today;
    const pickDay = (value: string) => {
        if (!value) return;
        const next = parseDayParam(value, today);
        setDay(next);
        // replace, not push — flicking through days shouldn't pile up history
        window.history.replaceState(null, '', next === today ? '/fleet' : `/fleet?date=${next}`);
    };

    const [drivers, setDrivers] = useState<DriverFleetStatus[] | null>(null);
    const [error, setError] = useState('');
    // Locate-on-map: the list's Locate button bumps this; FleetMap pans to it
    const [focusTarget, setFocusTarget] = useState<{ administratorId: string; ts: number } | null>(null);
    const mapBoxRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const list = await fetchDriverStatuses(channelToken ?? undefined);
            setDrivers(list);
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load fleet status');
        }
    }, [channelToken]);

    // Live push (today only): snapshot on every (re)connect, per-driver
    // patches in between. driver-update = full status change (state, km);
    // driver-live = streamed ride positions (~2.5 s) — just move the marker
    // and keep presence fresh.
    const { connected } = useFleetSocket(allowed && isToday, channelToken, {
        onSnapshotNeeded: load,
        // String() both sides: query rows carry GraphQL-serialized string ids,
        // socket pushes carry whatever the server object held — a strict ===
        // on mixed types silently drops every push (page then only updates on
        // refresh, which is exactly the bug this comparison used to cause).
        onDriverUpdate: (d) =>
            setDrivers((prev) =>
                prev
                    ? prev.map((x) =>
                          String(x.administratorId) === String(d.administratorId) ? d : x,
                      )
                    : prev,
            ),
        onDriverLive: (u) =>
            setDrivers((prev) =>
                prev
                    ? prev.map((x) =>
                          String(x.administratorId) === String(u.administratorId)
                              ? {
                                    ...x,
                                    lat: u.lat,
                                    lng: u.lng,
                                    lastHeartbeatAt: new Date(u.at).toISOString(),
                                    // A live fix PROVES GPS is delivering — an
                                    // Inactive rider (GPS was off) flips back
                                    // to their true state the moment fixes
                                    // resume, order id intact.
                                    gpsOn: true,
                                    state: (u.activeOrderId ?? x.activeOrderId)
                                        ? ('OUT_FOR_DELIVERY' as DriverFleetState)
                                        : ('ACTIVE' as DriverFleetState),
                                }
                              : x,
                      )
                    : prev,
            ),
    });

    // Poll — the FALLBACK path: initial load always, then every 10 s only
    // while the socket is down. With the socket up, pushes carry the updates.
    // Past days have no live layer, so nothing to poll.
    useEffect(() => {
        if (!allowed || !isToday) return;
        const t0 = setTimeout(load, 0);
        if (connected) return () => clearTimeout(t0);
        const t = setInterval(load, FLEET_POLL_MS);
        return () => {
            clearTimeout(t0);
            clearInterval(t);
        };
    }, [load, allowed, connected, isToday]);

    // Between pushes a silent driver must decay to Inactive CLIENT-side too
    // (the server derives it per query, but no query runs while the socket
    // is quiet).
    const displayedDrivers = useMemo(() => {
        if (!drivers) return null;
        return drivers.map((d) => {
            const stale =
                !d.lastHeartbeatAt || nowMs - new Date(d.lastHeartbeatAt).getTime() > 60_000;
            // Silence downgrades EVERY live state — including a mid-ride
            // driver whose GPS/data went dark. The open ride survives on the
            // backend (resume/km unaffected); the badge simply tells the
            // truth, and flips back when fixes resume.
            return (d.state === 'ACTIVE' || d.state === 'OUT_FOR_DELIVERY') && stale
                ? { ...d, state: 'INACTIVE' as DriverFleetState }
                : d;
        });
    }, [drivers, nowMs]);

    // ─── Who closed orders that day ────────────────────────────────
    // Results are tagged with channel + day so a slow response for a
    // previous pick can never show under the current one.
    const dayKey = `${channelToken ?? ''}|${day}`;
    const [dayData, setDayData] = useState<{ key: string; summaries: DeliveryPersonSummary[] } | null>(null);
    const [pastMeters, setPastMeters] = useState<{ key: string; byId: Map<string, number> } | null>(null);
    const [dayError, setDayError] = useState<{ key: string; message: string } | null>(null);

    useEffect(() => {
        if (!allowed) return;
        let cancelled = false;
        const key = `${channelToken ?? ''}|${day}`;
        const { from, to } = istDayBounds(day);
        const token = channelToken ?? undefined;
        const run = async () => {
            try {
                const report = await fetchDeliveryReport(from.toISOString(), to.toISOString(), undefined, undefined, undefined, token);
                if (cancelled) return;
                setDayData({ key, summaries: report.summaries });
                setDayError(null);
                // Today's km is live (metersToday on the status rows); a past
                // day sums each rider's rides started that day — the same rule.
                if (isToday) return;
                const ids = [...new Set(report.summaries.map((s) => String(s.deliveryPersonId)).filter(Boolean))];
                const rides = await Promise.allSettled(ids.map((id) => fetchDriverRides(id, from, to, token)));
                if (cancelled) return;
                const byId = new Map<string, number>();
                rides.forEach((r, i) => {
                    if (r.status === 'fulfilled') byId.set(ids[i], metersStartedIn(r.value, from, to));
                });
                setPastMeters({ key, byId });
            } catch (e) {
                if (!cancelled) setDayError({ key, message: e instanceof Error ? e.message : 'Failed to load deliveries' });
            }
        };
        const t0 = setTimeout(run, 0);
        const t = isToday ? setInterval(run, DAY_POLL_MS) : undefined;
        return () => {
            cancelled = true;
            clearTimeout(t0);
            if (t) clearInterval(t);
        };
    }, [allowed, day, isToday, channelToken]);

    const summaries = dayData?.key === dayKey ? dayData.summaries : null;
    const rows = useMemo(
        () => (summaries ? dayDeliverers(summaries, isToday ? (displayedDrivers ?? []) : []) : null),
        [summaries, isToday, displayedDrivers],
    );
    const dayErrorMessage = dayError?.key === dayKey ? dayError.message : '';

    if (!allowed) {
        return (
            <div className="flex items-center justify-center p-16 text-center text-[var(--text-muted)]">
                <div>
                    <h3 className="text-lg font-semibold mb-1 text-[var(--foreground)]">Fleet monitoring</h3>
                    <p className="text-[0.8125rem]">This page is for admins — your account doesn&apos;t have access.</p>
                </div>
            </div>
        );
    }

    const counts = (displayedDrivers ?? []).reduce(
        (acc, d) => { acc[d.state] = (acc[d.state] ?? 0) + 1; return acc; },
        {} as Record<string, number>,
    );
    const totalDelivered = (rows ?? []).reduce((sum, r) => sum + r.delivered, 0);

    const metersFor = (r: FleetDayRow): number | null => {
        if (isToday) return r.live ? r.live.metersToday : null;
        return pastMeters?.key === dayKey ? (pastMeters.byId.get(r.administratorId) ?? null) : null;
    };
    const kmLabel = (r: FleetDayRow) => {
        const m = metersFor(r);
        return m != null && m > 0 ? formatDistance(m) : '—';
    };
    const canLocate = (r: FleetDayRow) =>
        isToday && !!r.live && r.live.state !== 'INACTIVE' && r.live.lat != null && r.live.lng != null;
    const locate = (r: FleetDayRow, ts: number) => {
        setFocusTarget({ administratorId: r.administratorId, ts });
        mapBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const openDriver = (r: FleetDayRow) =>
        router.push(`/fleet/${r.administratorId}?name=${encodeURIComponent(r.name)}&date=${day}`);

    const headers = isToday
        ? ['Name', 'Delivered', 'Km', 'State', 'Current order', 'Last seen', '']
        : ['Name', 'Delivered', 'Km'];

    return (
        <div className="flex flex-col h-full">
            {/* ─── Header ────────────────────────────────────────────── */}
            <div className="px-4 md:px-6 pt-4 pb-3 flex items-center gap-3 flex-wrap">
                <h1 className="text-[1.0625rem] font-bold text-[var(--foreground)]">Fleet</h1>
                {isToday && displayedDrivers && (
                    <span className="text-[0.75rem] text-[var(--text-muted)]">
                        {counts.OUT_FOR_DELIVERY ?? 0} out for delivery · {counts.ACTIVE ?? 0} active · {counts.INACTIVE ?? 0} inactive
                    </span>
                )}
                <div className="ml-auto flex items-center gap-3">
                    {isToday && (
                        <span
                            className="inline-flex items-center gap-1.5 text-[0.6875rem]"
                            style={{ color: connected ? 'var(--tone-green-deep)' : 'var(--text-muted)' }}
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: connected ? 'var(--tone-green-deep)' : 'var(--text-muted)' }}
                            />
                            {connected ? 'live' : 'updates every 10 s'}
                        </span>
                    )}
                    <input
                        type="date"
                        value={day}
                        max={today}
                        onChange={(e) => pickDay(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--foreground)] text-[0.8125rem] outline-none cursor-pointer transition-all duration-200 focus:border-[var(--accent)]"
                        aria-label="Day"
                    />
                </div>
            </div>

            {/* ─── Map (today only — it shows where riders are NOW) ──── */}
            {/* Explicit responsive heights (no dvh/min() — a failed value
                collapses the box to a border-only line) + shrink-0 so the
                flex column can never squeeze it away */}
            {isToday && (
                <>
                    {error && (
                        <div className="px-4 md:px-6 pb-2 text-[0.75rem] text-[var(--error)]">{error}</div>
                    )}
                    <div
                        ref={mapBoxRef}
                        className="mx-3 md:mx-6 h-[240px] md:h-[380px] shrink-0 rounded-xl overflow-hidden border border-[var(--card-border)]"
                        style={{ background: 'var(--card-bg)' }}
                    >
                        {/* key: remount per channel so the map re-fits its bounds onto
                            the new channel's riders instead of staying on the old city */}
                        <FleetMap key={channelToken ?? 'none'} drivers={displayedDrivers ?? []} focus={focusTarget} />
                    </div>
                </>
            )}

            {/* ─── Riders who closed orders that day (cards on mobile, table on md+) */}
            <div className="flex-1 px-3 md:px-6 py-4">
                <div className="px-1 mb-2.5 flex items-baseline gap-2 flex-wrap">
                    <h2 className="text-[0.8125rem] font-semibold text-[var(--foreground)]">
                        {isToday ? 'Delivered today' : `Delivered on ${formatDayLabel(day)}`}
                    </h2>
                    {rows && rows.length > 0 && (
                        <span className="text-[0.75rem] text-[var(--text-muted)]">
                            {plural(totalDelivered, 'order')} · {plural(rows.length, 'delivery person')}
                        </span>
                    )}
                </div>

                {!rows && dayErrorMessage ? (
                    <div className="text-center text-[0.8125rem] text-[var(--error)] py-8">{dayErrorMessage}</div>
                ) : !rows ? (
                    <div className="flex justify-center py-10"><Spinner size="lg" /></div>
                ) : rows.length === 0 ? (
                    <div className="text-center text-[0.8125rem] text-[var(--text-muted)] py-8">
                        {isToday
                            ? 'No orders delivered yet today — riders on the road show on the map.'
                            : 'No delivery person closed an order on this day.'}
                    </div>
                ) : (
                    <>
                    {/* ── Mobile cards ── */}
                    <div className="md:hidden flex flex-col gap-2">
                        {rows.map((r) => (
                            <div
                                key={r.administratorId}
                                onClick={() => openDriver(r)}
                                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 cursor-pointer active:bg-overlay/[0.04]"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[0.875rem] font-semibold text-[var(--foreground)] truncate">{r.name}</div>
                                        {r.phoneNumber && (
                                            <div className="text-[0.6875rem] text-[var(--text-muted)]">{r.phoneNumber}</div>
                                        )}
                                    </div>
                                    {isToday && r.live && <StateBadge state={r.live.state} />}
                                </div>
                                <div className="mt-2.5 flex items-center justify-between gap-2 text-[0.75rem] text-[var(--text-muted)]">
                                    <span>
                                        <span className="text-[var(--foreground)] font-semibold">{r.delivered}</span> delivered
                                        {' · '}
                                        {kmLabel(r)}
                                        {isToday && r.live && <>{' · '}{lastSeenLabel(r.live.lastHeartbeatAt)}</>}
                                    </span>
                                    {canLocate(r) && <LocateButton name={r.name} onLocate={(ts) => locate(r, ts)} />}
                                </div>
                                {isToday && r.live?.activeOrderCode && (
                                    <div className="mt-1.5 text-[0.6875rem] text-[var(--text-muted)]">
                                        Order: <span className="text-[var(--foreground)] font-medium">{r.live.activeOrderCode}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* ── Desktop table ── */}
                    <div className="hidden md:block rounded-xl border border-[var(--card-border)] overflow-x-auto">
                        <table className="w-full border-collapse min-w-[560px]">
                            <thead>
                                <tr>
                                    {headers.map((h) => (
                                        <th
                                            key={h}
                                            className="px-4 py-3 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--card-border)] whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.administratorId}
                                        onClick={() => openDriver(r)}
                                        className="cursor-pointer transition-colors hover:bg-overlay/[0.04]"
                                    >
                                        <td className="px-4 py-3 border-b border-[var(--card-border)]">
                                            <div className="text-[0.8125rem] font-semibold text-[var(--foreground)]">{r.name}</div>
                                            {r.phoneNumber && (
                                                <div className="text-[0.6875rem] text-[var(--text-muted)]">{r.phoneNumber}</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 border-b border-[var(--card-border)] text-[0.8125rem] font-semibold text-[var(--foreground)] whitespace-nowrap">
                                            {r.delivered}
                                        </td>
                                        <td className="px-4 py-3 border-b border-[var(--card-border)] text-[0.8125rem] text-[var(--foreground)] whitespace-nowrap">
                                            {kmLabel(r)}
                                        </td>
                                        {isToday && (
                                            <>
                                                <td className="px-4 py-3 border-b border-[var(--card-border)]">
                                                    {r.live ? <StateBadge state={r.live.state} /> : <span className="text-[0.8125rem] text-[var(--text-muted)]">—</span>}
                                                </td>
                                                <td className="px-4 py-3 border-b border-[var(--card-border)] text-[0.8125rem] text-[var(--text-muted)] whitespace-nowrap">
                                                    {r.live?.activeOrderCode ?? '—'}
                                                </td>
                                                <td className="px-4 py-3 border-b border-[var(--card-border)] text-[0.75rem] text-[var(--text-muted)] whitespace-nowrap">
                                                    {r.live ? lastSeenLabel(r.live.lastHeartbeatAt) : '—'}
                                                </td>
                                                <td className="px-4 py-3 border-b border-[var(--card-border)] whitespace-nowrap text-right">
                                                    {canLocate(r) && <LocateButton name={r.name} onLocate={(ts) => locate(r, ts)} />}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    </>
                )}
            </div>
        </div>
    );
}
