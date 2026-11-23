/**
 * Live delivery tracking service — rides, heartbeats, and fleet monitoring.
 *
 * The backend owns the truth (delivery_ride / driver_status tables); this
 * service is a thin typed wrapper over the GraphQL operations. Heartbeats are
 * deliberately fire-and-forget: a failed ping just makes the driver look
 * inactive until the next one lands.
 */

import { vendureFetch } from '@/graphql/client';
import {
    ACTIVE_RIDE_FOR_ME,
    COMPLETE_DELIVERY_RIDE,
    DRIVER_ASSIGNED_ORDERS,
    DRIVER_HEARTBEAT,
    DRIVER_RIDES,
    DRIVER_STATUSES,
    START_DELIVERY_RIDE,
} from '@/graphql/operations/tracking';

// ─── Types ───────────────────────────────────────────────────────────

export interface DeliveryRideInfo {
    id: string;
    administratorId: string;
    orderId: string;
    orderCode: string;
    startedAt: string;
    /** Null while the ride is in progress */
    deliveredAt: string | null;
    /** Cumulative odometer for the ride, meters */
    distanceMeters: number;
}

/** One order assignment (fulfillment) of a driver — fleet detail page. */
export interface DriverAssignedOrder {
    fulfillmentId: string;
    orderId: string;
    orderCode: string;
    /** Fulfillment state: Created/Pending/Shipped (assigned), OutforDelivery, Delivered, Cancelled */
    state: string;
    assignedAt: string;
    /** Null unless Delivered */
    deliveredAt: string | null;
    customerName: string | null;
    area: string | null;
    /** Order total incl. shipping, paise */
    orderTotal: number;
}

export type DriverFleetState = 'OUT_FOR_DELIVERY' | 'ACTIVE' | 'INACTIVE';

export interface DriverFleetStatus {
    administratorId: string;
    name: string;
    phoneNumber: string | null;
    state: DriverFleetState;
    lat: number | null;
    lng: number | null;
    gpsOn: boolean;
    lastHeartbeatAt: string | null;
    metersToday: number;
    activeOrderId: string | null;
    activeOrderCode: string | null;
}

export interface DriverHeartbeatInput {
    lat?: number;
    lng?: number;
    gpsOn: boolean;
    /** Cumulative meters for the open ride — server keeps the max */
    rideDistanceMeters?: number;
    orderId?: string;
}

// ─── Driver-side ─────────────────────────────────────────────────────

export async function fetchActiveRideForMe(channelToken?: string): Promise<DeliveryRideInfo | null> {
    const res = await vendureFetch<{ activeRideForMe: DeliveryRideInfo | null }>(
        ACTIVE_RIDE_FOR_ME,
        {},
        channelToken,
    );
    return res.data.activeRideForMe;
}

/** Fire-and-forget presence ping. Never throws. */
export async function sendDriverHeartbeat(
    input: DriverHeartbeatInput,
    channelToken?: string,
): Promise<void> {
    try {
        await vendureFetch(DRIVER_HEARTBEAT, { input }, channelToken);
    } catch {
        // Missed pings are expected on flaky mobile networks — the fleet page
        // simply shows the driver as inactive until the next one lands.
    }
}

export async function startDeliveryRide(
    orderId: string,
    channelToken?: string,
): Promise<DeliveryRideInfo> {
    const res = await vendureFetch<{ startDeliveryRide: DeliveryRideInfo }>(
        START_DELIVERY_RIDE,
        { orderId },
        channelToken,
    );
    return res.data.startDeliveryRide;
}

export async function completeDeliveryRide(
    orderId: string,
    finalDistanceMeters?: number,
    channelToken?: string,
): Promise<DeliveryRideInfo> {
    const res = await vendureFetch<{ completeDeliveryRide: DeliveryRideInfo }>(
        COMPLETE_DELIVERY_RIDE,
        { orderId, finalDistanceMeters },
        channelToken,
    );
    return res.data.completeDeliveryRide;
}

// ─── Fleet-side (admin) ──────────────────────────────────────────────

export async function fetchDriverStatuses(channelToken?: string): Promise<DriverFleetStatus[]> {
    const res = await vendureFetch<{ driverStatuses: DriverFleetStatus[] }>(
        DRIVER_STATUSES,
        {},
        channelToken,
    );
    return res.data.driverStatuses;
}

export async function fetchDriverRides(
    deliveryPersonId: string,
    dateFrom: Date,
    dateTo: Date,
    channelToken?: string,
): Promise<DeliveryRideInfo[]> {
    const res = await vendureFetch<{ driverRides: DeliveryRideInfo[] }>(
        DRIVER_RIDES,
        {
            deliveryPersonId,
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString(),
        },
        channelToken,
    );
    return res.data.driverRides;
}

export async function fetchDriverAssignedOrders(
    deliveryPersonId: string,
    dateFrom: Date,
    dateTo: Date,
    channelToken?: string,
): Promise<DriverAssignedOrder[]> {
    const res = await vendureFetch<{ driverAssignedOrders: DriverAssignedOrder[] }>(
        DRIVER_ASSIGNED_ORDERS,
        {
            deliveryPersonId,
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString(),
        },
        channelToken,
    );
    return res.data.driverAssignedOrders;
}
