import { describe, expect, test } from 'bun:test';
import {
    assignmentStatus,
    dayDeliverers,
    istDayBounds,
    metersStartedIn,
    parseDayParam,
    ridesByOrderCode,
    sortAssignments,
    todayIst,
} from './fleet-day';
import type { DeliveryRideInfo, DriverAssignedOrder, DriverFleetStatus } from '@/services/tracking.service';

describe('IST days', () => {
    test('today is the IST calendar day, not the UTC one', () => {
        // 20:00 UTC on the 28th is already 01:30 on the 29th in India
        expect(todayIst(new Date('2026-10-28T20:00:00Z'))).toBe('2026-10-29');
        expect(todayIst(new Date('2026-10-28T18:00:00Z'))).toBe('2026-10-28');
    });

    test('a day spans IST midnight to the last millisecond before the next', () => {
        const { from, to } = istDayBounds('2026-10-28');
        expect(from.toISOString()).toBe('2026-10-27T18:30:00.000Z');
        expect(to.toISOString()).toBe('2026-10-28T18:29:59.999Z');
    });

    test('?date= accepts real days up to today and falls back to today otherwise', () => {
        const today = '2026-10-29';
        expect(parseDayParam('2026-10-20', today)).toBe('2026-10-20');
        expect(parseDayParam(today, today)).toBe(today);
        expect(parseDayParam(null, today)).toBe(today);
        expect(parseDayParam('', today)).toBe(today);
        expect(parseDayParam('yesterday', today)).toBe(today);
        expect(parseDayParam('2026-02-31', today)).toBe(today);
        // The future has no deliveries yet — clamp, don't show an empty page
        expect(parseDayParam('2026-11-05', today)).toBe(today);
    });
});

function summary(id: string, name: string, totalDeliveries: number, phone: string | null = null) {
    return { deliveryPersonId: id, deliveryPersonName: name, deliveryPersonPhone: phone, totalDeliveries };
}

function live(id: string, name: string, over: Partial<DriverFleetStatus> = {}): DriverFleetStatus {
    return {
        administratorId: id,
        name,
        phoneNumber: '90000',
        state: 'ACTIVE',
        lat: null,
        lng: null,
        gpsOn: true,
        lastHeartbeatAt: null,
        metersToday: 0,
        activeOrderId: null,
        activeOrderCode: null,
        ...over,
    };
}

describe('dayDeliverers', () => {
    test('lists only riders who closed an order, busiest first', () => {
        const rows = dayDeliverers([summary('2', 'Bala', 3), summary('5', 'Arun', 7), summary('9', 'Zero', 0)]);
        expect(rows.map((r) => [r.administratorId, r.delivered])).toEqual([
            ['5', 7],
            ['2', 3],
        ]);
    });

    test('merges a rider split across name snapshots into one row', () => {
        const rows = dayDeliverers([summary('2', 'Bala', 3), summary('2', 'Bala K', 2)]);
        expect(rows).toHaveLength(1);
        expect(rows[0].delivered).toBe(5);
    });

    test('takes the current name, phone and live status when the rider is on the live list', () => {
        const [row] = dayDeliverers(
            [summary('2', 'Old name', 1, '11111')],
            [live('2', 'Bala', { state: 'OUT_FOR_DELIVERY' })],
        );
        expect(row.name).toBe('Bala');
        expect(row.phoneNumber).toBe('90000');
        expect(row.live?.state).toBe('OUT_FOR_DELIVERY');
    });

    test('keeps the report snapshot for a rider no longer on the live list', () => {
        const [row] = dayDeliverers([summary('2', 'Bala', 1, '11111')], [live('3', 'Other')]);
        expect(row.name).toBe('Bala');
        expect(row.phoneNumber).toBe('11111');
        expect(row.live).toBeNull();
    });

    test('ignores rows without a rider id', () => {
        expect(dayDeliverers([summary('', 'Ghost', 4)])).toEqual([]);
    });

    test('breaks a tie by name', () => {
        const rows = dayDeliverers([summary('1', 'Siva', 2), summary('2', 'Arun', 2)]);
        expect(rows.map((r) => r.name)).toEqual(['Arun', 'Siva']);
    });
});

function ride(orderCode: string, startedAt: string, distanceMeters: number, deliveredAt: string | null = null): DeliveryRideInfo {
    return { id: `${orderCode}-${startedAt}`, administratorId: '2', orderId: '1', orderCode, startedAt, deliveredAt, distanceMeters };
}

describe('ride km', () => {
    const { from, to } = istDayBounds('2026-10-28');

    test("sums the rides that STARTED in the day — the backend's km-today rule", () => {
        const rides = [
            ride('A', '2026-10-27T18:00:00Z', 900), // 23:30 IST the day before
            ride('B', '2026-10-28T04:00:00Z', 2500),
            ride('C', '2026-10-28T10:00:00Z', 1200),
        ];
        expect(metersStartedIn(rides, from, to)).toBe(3700);
    });

    test('indexes rides by order, keeping the latest ride of a re-delivered order', () => {
        const byCode = ridesByOrderCode([
            ride('A', '2026-10-28T04:00:00Z', 500, '2026-10-28T04:20:00Z'),
            ride('A', '2026-10-28T09:00:00Z', 1800, '2026-10-28T09:30:00Z'),
            ride('B', '2026-10-28T05:00:00Z', 700),
        ]);
        expect(byCode.get('A')?.distanceMeters).toBe(1800);
        expect(byCode.get('B')?.distanceMeters).toBe(700);
        expect(byCode.get('Z')).toBeUndefined();
    });
});

function assignment(code: string, state: string, assignedAt: string): DriverAssignedOrder {
    return {
        fulfillmentId: code,
        orderId: code,
        orderCode: code,
        state,
        assignedAt,
        deliveredAt: state === 'Delivered' ? assignedAt : null,
        customerName: null,
        area: null,
        orderTotal: 0,
    };
}

describe('assignments', () => {
    test('maps fulfillment states to what the admin sees', () => {
        expect(assignmentStatus('Shipped')).toEqual({ label: 'Assigned', tone: 'pending', open: true });
        expect(assignmentStatus('Pending').tone).toBe('pending');
        expect(assignmentStatus('OutforDelivery')).toEqual({ label: 'Out for delivery', tone: 'riding', open: true });
        expect(assignmentStatus('Delivered')).toEqual({ label: 'Delivered', tone: 'delivered', open: false });
        expect(assignmentStatus('Cancelled')).toEqual({ label: 'Cancelled', tone: 'cancelled', open: false });
    });

    test('puts work still on the road first, then waiting, delivered, cancelled — newest first within', () => {
        const sorted = sortAssignments([
            assignment('delivered-old', 'Delivered', '2026-10-28T03:00:00Z'),
            assignment('cancelled', 'Cancelled', '2026-10-28T09:00:00Z'),
            assignment('waiting-old', 'Shipped', '2026-10-28T04:00:00Z'),
            assignment('riding', 'OutforDelivery', '2026-10-28T02:00:00Z'),
            assignment('waiting-new', 'Shipped', '2026-10-28T08:00:00Z'),
            assignment('delivered-new', 'Delivered', '2026-10-28T07:00:00Z'),
        ]);
        expect(sorted.map((a) => a.orderCode)).toEqual([
            'riding',
            'waiting-new',
            'waiting-old',
            'delivered-new',
            'delivered-old',
            'cancelled',
        ]);
    });
});
