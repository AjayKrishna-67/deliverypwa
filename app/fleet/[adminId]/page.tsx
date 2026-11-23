'use client';

/**
 * /fleet/[adminId] — one delivery person's day.
 *
 * The day comes from the fleet page's filter (?date=YYYY-MM-DD, IST; today
 * when absent). Two lists:
 *  - Delivered: orders whose delivery closed that day (`deliveryReport`),
 *    each with its ride times and km from `driverRides`.
 *  - Assigned: every order the rider held that day — assigned that day,
 *    closed that day, or still open (`driverAssignedOrders`) — with its
 *    current state.
 * The distance total is the km of rides started that day, the same figure
 * the fleet list shows. Today re-polls every 30 s. The display name arrives
 * via ?name= from the fleet list (falls back to the id).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { Spinner } from '@/components/ui/Spinner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { formatDistance } from '@/lib/maps';
import {
    assignmentStatus,
    formatDayLabel,
    istDayBounds,
    metersStartedIn,
    parseDayParam,
    ridesByOrderCode,
    sortAssignments,
    todayIst,
    type AssignmentTone,
} from '@/lib/fleet-day';
import { fetchDeliveryReport, type DeliveryFulfillmentDetailItem } from '@/services/reports.service';
import {
    fetchDriverAssignedOrders,
    fetchDriverRides,
    type DeliveryRideInfo,
    type DriverAssignedOrder,
} from '@/services/tracking.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_POLL_MS = 30_000;
/** One rider's day never comes near this — it just lifts the report's default page of 50. */
const MAX_DAY_DELIVERIES = 500;

function formatTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

/** Time alone when it falls on `day`; with the date otherwise (orders carried over from earlier). */
function formatTimeOnDay(iso: string, day: string): string {
    if (todayIst(new Date(iso)) === day) return formatTime(iso);
    return new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

function rideDuration(startIso: string | undefined, endIso: string | null | undefined): string {
    if (!startIso || !endIso) return '—';
    const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
    return mins < 1 ? '<1 min' : `${mins} min`;
}

/** An older backend has no driverAssignedOrders — say so instead of a raw GraphQL error. */
function assignedErrorMessage(e: unknown): string {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Cannot query field "driverAssignedOrders"')) {
        return 'Assigned orders need the latest backend update.';
    }
    return msg || 'Failed to load assigned orders';
}

// ─── Small pieces ────────────────────────────────────────────────────

const TONE_STYLES: Record<AssignmentTone, { color: string; bg: string; border: string }> = {
    riding: { color: 'var(--tone-teal-deep)', bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.35)' },
    pending: { color: 'var(--tone-amber-deep)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' },
    delivered: { color: 'var(--tone-green-deep)', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' },
    cancelled: { color: 'var(--tone-slate)', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)' },
};

function AssignmentBadge({ state }: { state: string }) {
    const { label, tone } = assignmentStatus(state);
    const s = TONE_STYLES[tone];
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold whitespace-nowrap"
            style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            {label}
        </span>
    );
}

function Tile({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="px-4 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]">
            <div className="text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
            <div className="text-[1rem] font-bold text-[var(--foreground)]">{value}</div>
        </div>
    );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
    return (
        <div className="mb-2.5 flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[0.8125rem] font-semibold text-[var(--foreground)]">{title}</h2>
            {note && <span className="text-[0.75rem] text-[var(--text-muted)]">{note}</span>}
        </div>
    );
}

const TH = 'px-4 py-3 text-left text-[0.6875rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--card-border)] whitespace-nowrap';
const TD = 'px-4 py-3 border-b border-[var(--card-border)] text-[0.8125rem] whitespace-nowrap';

// ─── Page ────────────────────────────────────────────────────────────

export default function FleetDriverPage() {
    const { isLoading, isAuthenticated } = useRequireAuth();

    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return null;

    return (
        <DashboardLayout>
            {({ channelToken }) => <DriverDayContent channelToken={channelToken} />}
        </DashboardLayout>
    );
}

interface DayData {
    delivered: DeliveryFulfillmentDetailItem[];
    rides: DeliveryRideInfo[];
    /** Name + phone snapshot from the report — null when nothing was delivered that day */
    person: { name: string; phone: string | null } | null;
}

function DriverDayContent({ channelToken }: { channelToken: string | null }) {
    const { adminId } = useParams<{ adminId: string }>();
    const router = useRouter();
    // window.location instead of useSearchParams() — avoids the Suspense
    // boundary Next requires for useSearchParams in prerendered client pages
    const [{ nameParam, day }] = useState(() => {
        if (typeof window === 'undefined') return { nameParam: null, day: todayIst() };
        const q = new URLSearchParams(window.location.search);
        return { nameParam: q.get('name'), day: parseDayParam(q.get('date')) };
    });
    const isToday = day === todayIst();

    // The day's data is stored with the request it answers. A driver or branch
    // change moves the key, so the old lists stop showing at once and the
    // loading state appears — no reset effect needed.
    const requestKey = `${adminId}|${day}|${channelToken ?? ''}`;
    const [result, setResult] = useState<{ key: string; data: DayData } | null>(null);
    const data = result?.key === requestKey ? result.data : null;
    const [error, setError] = useState('');
    const [assignedResult, setAssignedResult] = useState<{ key: string; rows: DriverAssignedOrder[] } | null>(null);
    const assigned = assignedResult?.key === requestKey ? assignedResult.rows : null;
    const [assignedError, setAssignedError] = useState('');

    const load = useCallback(async () => {
        const { from, to } = istDayBounds(day);
        const token = channelToken ?? undefined;
        const [report, rides, held] = await Promise.allSettled([
            fetchDeliveryReport(from.toISOString(), to.toISOString(), adminId, 0, MAX_DAY_DELIVERIES, token),
            // From the evening before: a ride started at 23:50 and delivered
            // at 00:10 still carries the km of one of this day's deliveries
            fetchDriverRides(adminId, new Date(from.getTime() - DAY_MS), to, token),
            fetchDriverAssignedOrders(adminId, from, to, token),
        ]);
        if (report.status === 'fulfilled' && rides.status === 'fulfilled') {
            // Filtered to one rider, the report puts all their deliveries on the first summary
            const summary = report.value.summaries[0];
            setResult({
                key: requestKey,
                data: {
                    delivered: summary?.fulfillments ?? [],
                    rides: rides.value,
                    person: summary ? { name: summary.deliveryPersonName, phone: summary.deliveryPersonPhone ?? null } : null,
                },
            });
            setError('');
        } else {
            const failed = report.status === 'rejected' ? report.reason : (rides as PromiseRejectedResult).reason;
            setError(failed instanceof Error ? failed.message : 'Failed to load deliveries');
        }
        // Assigned is its own section — an older backend without it must not blank the deliveries
        if (held.status === 'fulfilled') {
            setAssignedResult({ key: requestKey, rows: held.value });
            setAssignedError('');
        } else {
            setAssignedError(assignedErrorMessage(held.reason));
        }
    }, [adminId, day, channelToken, requestKey]);

    useEffect(() => {
        const t0 = setTimeout(load, 0);
        const t = isToday ? setInterval(load, DAY_POLL_MS) : undefined;
        return () => {
            clearTimeout(t0);
            if (t) clearInterval(t);
        };
    }, [load, isToday]);

    const view = useMemo(() => {
        if (!data) return null;
        const { from, to } = istDayBounds(day);
        const rideByCode = ridesByOrderCode(data.rides);
        const delivered = [...data.delivered]
            .sort((a, b) => new Date(b.deliveredAt ?? 0).getTime() - new Date(a.deliveredAt ?? 0).getTime())
            .map((f) => ({ ...f, ride: rideByCode.get(f.orderCode) ?? null }));
        return { delivered, rideByCode, totalMeters: metersStartedIn(data.rides, from, to) };
    }, [data, day]);
    const assignedRows = useMemo(() => (assigned ? sortAssignments(assigned) : null), [assigned]);
    const openCount = (assignedRows ?? []).filter((a) => assignmentStatus(a.state).open).length;
    // ?name= from the fleet list first; a pasted link without it still gets the report's name
    const driverName = nameParam || data?.person?.name || `Driver #${adminId}`;
    const driverPhone = data?.person?.phone ?? null;

    const assignedKm = (a: DriverAssignedOrder): string => {
        const ride = view?.rideByCode.get(a.orderCode);
        if (!ride || ride.distanceMeters <= 0) return '—';
        return ride.deliveredAt ? formatDistance(ride.distanceMeters) : `${formatDistance(ride.distanceMeters)} so far`;
    };

    return (
        <div className="flex flex-col h-full">
            {/* ─── Header ────────────────────────────────────────────── */}
            <div className="px-4 md:px-6 pt-4 pb-3 flex items-center gap-3 flex-wrap">
                <button
                    onClick={() => router.push(isToday ? '/fleet' : `/fleet?date=${day}`)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors hover:bg-overlay/10 text-[var(--text-muted)]"
                    title="Back to fleet"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                    </svg>
                </button>
                {/* The name lives in the block above the summary — the header just carries the day */}
                <h1 className="text-[1.0625rem] font-bold text-[var(--foreground)]">
                    {isToday ? `Today · ${formatDayLabel(day)}` : formatDayLabel(day)}
                </h1>
            </div>

            {/* ─── Summary ───────────────────────────────────────────── */}
            <div className="px-4 md:px-6 pb-2">
                <div className="text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Delivery person</div>
                <div className="text-[1rem] font-bold text-[var(--foreground)]">
                    {driverName}
                    {driverPhone && (
                        <span className="ml-2 text-[0.75rem] font-normal text-[var(--text-muted)]">{driverPhone}</span>
                    )}
                </div>
            </div>
            {view && (
                <div className="px-4 md:px-6 pb-3 flex gap-3 flex-wrap">
                    <Tile label="Delivered" value={view.delivered.length} />
                    <Tile label="Distance" value={view.totalMeters > 0 ? formatDistance(view.totalMeters) : '—'} />
                    <Tile label="Assigned" value={assignedRows ? assignedRows.length : '—'} />
                    <Tile label="Pending" value={assignedRows ? openCount : '—'} />
                </div>
            )}

            <div className="flex-1 px-4 md:px-6 pb-4 flex flex-col gap-6">
                {/* ─── Delivered orders ─────────────────────────────── */}
                <section>
                    <SectionTitle title="Delivered orders" note="with ride time and distance" />
                    {error && !view ? (
                        <div className="text-center text-[0.8125rem] text-[var(--error)] py-8">{error}</div>
                    ) : !view ? (
                        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
                    ) : view.delivered.length === 0 ? (
                        <div className="text-center text-[0.8125rem] text-[var(--text-muted)] py-6">
                            No orders delivered on this day.
                        </div>
                    ) : (
                        <>
                        {/* ── Mobile cards ── */}
                        <div className="md:hidden flex flex-col gap-2">
                            {view.delivered.map((f, i) => (
                                <div key={`${f.orderCode}-${i}`} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-[0.875rem] font-semibold text-[var(--foreground)]">{f.orderCode}</div>
                                            {f.customerName && (
                                                <div className="text-[0.6875rem] text-[var(--text-muted)] truncate">{f.customerName}</div>
                                            )}
                                        </div>
                                        <span className="text-[0.875rem] font-semibold text-[var(--foreground)] whitespace-nowrap">
                                            {f.ride && f.ride.distanceMeters > 0 ? formatDistance(f.ride.distanceMeters) : '—'}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-[0.75rem] text-[var(--text-muted)]">
                                        Delivered {formatTime(f.deliveredAt)}
                                        {f.ride && <>{' · '}{rideDuration(f.ride.startedAt, f.ride.deliveredAt ?? f.deliveredAt)} ride</>}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ── Desktop table ── */}
                        <div className="hidden md:block rounded-xl border border-[var(--card-border)] overflow-x-auto">
                            <table className="w-full border-collapse min-w-[640px]">
                                <thead>
                                    <tr>
                                        {['Order', 'Customer', 'Out at', 'Delivered', 'Ride time', 'Km'].map((h) => (
                                            <th key={h} className={TH}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {view.delivered.map((f, i) => (
                                        <tr key={`${f.orderCode}-${i}`}>
                                            <td className={`${TD} font-semibold text-[var(--foreground)]`}>{f.orderCode}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{f.customerName || '—'}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{formatTime(f.ride?.startedAt)}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{formatTime(f.deliveredAt)}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>
                                                {rideDuration(f.ride?.startedAt, f.ride?.deliveredAt ?? f.deliveredAt)}
                                            </td>
                                            <td className={`${TD} text-[var(--foreground)]`}>
                                                {f.ride && f.ride.distanceMeters > 0 ? formatDistance(f.ride.distanceMeters) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}
                </section>

                {/* ─── Assigned orders ──────────────────────────────── */}
                <section>
                    <SectionTitle title="Assigned orders" note="assigned this day, or still open with the rider" />
                    {assignedError && !assignedRows ? (
                        <div className="text-center text-[0.8125rem] text-[var(--text-muted)] py-6">{assignedError}</div>
                    ) : !assignedRows ? (
                        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
                    ) : assignedRows.length === 0 ? (
                        <div className="text-center text-[0.8125rem] text-[var(--text-muted)] py-6">
                            No orders assigned on this day.
                        </div>
                    ) : (
                        <>
                        {/* ── Mobile cards ── */}
                        <div className="md:hidden flex flex-col gap-2">
                            {assignedRows.map((a) => (
                                <div key={a.fulfillmentId} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-[0.875rem] font-semibold text-[var(--foreground)]">{a.orderCode}</div>
                                            {(a.customerName || a.area) && (
                                                <div className="text-[0.6875rem] text-[var(--text-muted)] truncate">
                                                    {[a.customerName, a.area].filter(Boolean).join(' · ')}
                                                </div>
                                            )}
                                        </div>
                                        <AssignmentBadge state={a.state} />
                                    </div>
                                    <div className="mt-2 text-[0.75rem] text-[var(--text-muted)]">
                                        Assigned {formatTimeOnDay(a.assignedAt, day)}
                                        {a.deliveredAt && <>{' · '}Delivered {formatTimeOnDay(a.deliveredAt, day)}</>}
                                        {assignedKm(a) !== '—' && <>{' · '}{assignedKm(a)}</>}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ── Desktop table ── */}
                        <div className="hidden md:block rounded-xl border border-[var(--card-border)] overflow-x-auto">
                            <table className="w-full border-collapse min-w-[680px]">
                                <thead>
                                    <tr>
                                        {['Order', 'Customer', 'Area', 'Assigned', 'Status', 'Km'].map((h) => (
                                            <th key={h} className={TH}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignedRows.map((a) => (
                                        <tr key={a.fulfillmentId}>
                                            <td className={`${TD} font-semibold text-[var(--foreground)]`}>{a.orderCode}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{a.customerName || '—'}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{a.area || '—'}</td>
                                            <td className={`${TD} text-[var(--text-muted)]`}>{formatTimeOnDay(a.assignedAt, day)}</td>
                                            <td className={TD}>
                                                <div className="flex items-center gap-2">
                                                    <AssignmentBadge state={a.state} />
                                                    {a.deliveredAt && (
                                                        <span className="text-[0.75rem] text-[var(--text-muted)]">
                                                            {formatTimeOnDay(a.deliveredAt, day)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={`${TD} text-[var(--foreground)]`}>{assignedKm(a)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
