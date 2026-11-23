/**
 * Day-scoped helpers for the fleet pages. The date filter lives on /fleet
 * and travels to /fleet/[adminId] as ?date=YYYY-MM-DD.
 *
 * A "day" is an IST calendar day whatever the browser's timezone — the same
 * window the backend uses for km-today and every report.
 */

import type { DeliveryPersonSummary } from '@/services/reports.service';
import type { DeliveryRideInfo, DriverAssignedOrder, DriverFleetStatus } from '@/services/tracking.service';

const IST_TZ = 'Asia/Kolkata';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's IST date as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
    // en-CA formats as YYYY-MM-DD
    return now.toLocaleDateString('en-CA', { timeZone: IST_TZ });
}

/** IST midnight → 23:59:59.999 of `day`. */
export function istDayBounds(day: string): { from: Date; to: Date } {
    return {
        from: new Date(`${day}T00:00:00.000+05:30`),
        to: new Date(`${day}T23:59:59.999+05:30`),
    };
}

/** A ?date= value → that day when it is a real day up to today, else today. */
export function parseDayParam(value: string | null | undefined, today: string = todayIst()): string {
    if (!value || !DAY_RE.test(value)) return today;
    const { from } = istDayBounds(value);
    // Round-trip rejects 2026-02-31 & co, which Date may silently roll over
    if (Number.isNaN(from.getTime()) || todayIst(from) !== value) return today;
    return value > today ? today : value;
}

/** "Wed, 28 Oct 2026" */
export function formatDayLabel(day: string): string {
    return istDayBounds(day).from.toLocaleDateString('en-IN', {
        timeZone: IST_TZ,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

// ─── Fleet list: who closed orders that day ──────────────────────────

export interface FleetDayRow {
    administratorId: string;
    name: string;
    phoneNumber: string | null;
    /** Orders whose delivery closed that day */
    delivered: number;
    /** Live status, when the rider is on the live list (today only) */
    live: DriverFleetStatus | null;
}

type SummaryRow = Pick<
    DeliveryPersonSummary,
    'deliveryPersonId' | 'deliveryPersonName' | 'deliveryPersonPhone' | 'totalDeliveries'
>;

/**
 * The riders who closed at least one order that day, busiest first. The
 * report groups by the name snapshot on each fulfillment, so a rider renamed
 * mid-day arrives as two rows — merged by id here.
 */
export function dayDeliverers(summaries: SummaryRow[], live: DriverFleetStatus[] = []): FleetDayRow[] {
    const liveById = new Map(live.map((d) => [String(d.administratorId), d]));
    const rows = new Map<string, FleetDayRow>();
    for (const s of summaries) {
        const id = String(s.deliveryPersonId || '');
        if (!id || s.totalDeliveries <= 0) continue;
        const existing = rows.get(id);
        if (existing) {
            existing.delivered += s.totalDeliveries;
            continue;
        }
        const l = liveById.get(id) ?? null;
        rows.set(id, {
            administratorId: id,
            name: l?.name || s.deliveryPersonName || `Driver #${id}`,
            phoneNumber: l ? l.phoneNumber : (s.deliveryPersonPhone ?? null),
            delivered: s.totalDeliveries,
            live: l,
        });
    }
    return [...rows.values()].sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));
}

// ─── Rides ───────────────────────────────────────────────────────────

/** Total km of the rides STARTED within the window — the backend's km-today rule. */
export function metersStartedIn(rides: DeliveryRideInfo[], from: Date, to: Date): number {
    const lo = from.getTime();
    const hi = to.getTime();
    return rides.reduce((sum, r) => {
        const t = new Date(r.startedAt).getTime();
        return t >= lo && t <= hi ? sum + r.distanceMeters : sum;
    }, 0);
}

/** Rides by order code; an order ridden twice keeps its latest ride. */
export function ridesByOrderCode(rides: DeliveryRideInfo[]): Map<string, DeliveryRideInfo> {
    const byCode = new Map<string, DeliveryRideInfo>();
    for (const r of rides) {
        const prev = byCode.get(r.orderCode);
        if (!prev || new Date(r.startedAt).getTime() > new Date(prev.startedAt).getTime()) {
            byCode.set(r.orderCode, r);
        }
    }
    return byCode;
}

// ─── Assigned orders ─────────────────────────────────────────────────

export type AssignmentTone = 'riding' | 'pending' | 'delivered' | 'cancelled';

/** Fulfillment state → what the admin sees. Anything not yet out the door is "Assigned". */
export function assignmentStatus(state: string): { label: string; tone: AssignmentTone; open: boolean } {
    switch (state) {
        case 'OutforDelivery':
            return { label: 'Out for delivery', tone: 'riding', open: true };
        case 'Delivered':
            return { label: 'Delivered', tone: 'delivered', open: false };
        case 'Cancelled':
            return { label: 'Cancelled', tone: 'cancelled', open: false };
        default:
            return { label: 'Assigned', tone: 'pending', open: true };
    }
}

const TONE_RANK: Record<AssignmentTone, number> = { riding: 0, pending: 1, delivered: 2, cancelled: 3 };

/** Work still on the road first, then waiting, delivered, cancelled — newest first within each. */
export function sortAssignments(list: DriverAssignedOrder[]): DriverAssignedOrder[] {
    return [...list].sort(
        (a, b) =>
            TONE_RANK[assignmentStatus(a.state).tone] - TONE_RANK[assignmentStatus(b.state).tone] ||
            new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime(),
    );
}
