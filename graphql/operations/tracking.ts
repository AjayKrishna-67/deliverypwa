/**
 * GraphQL operations for live delivery tracking (rides, heartbeats, fleet).
 * Backed by the DeliveryTracking additions to the delivery-strategy-router
 * plugin on the Vendure backend.
 */

export const RIDE_INFO_FIELDS = `
    id
    administratorId
    orderId
    orderCode
    startedAt
    deliveredAt
    distanceMeters
`;

/** The logged-in driver's most recent open ride (null when none) — resume. */
export const ACTIVE_RIDE_FOR_ME = `
    query ActiveRideForMe {
        activeRideForMe {
            ${RIDE_INFO_FIELDS}
        }
    }
`;

/** Presence ping — position, GPS state, cumulative ride odometer. */
export const DRIVER_HEARTBEAT = `
    mutation DriverHeartbeat($input: DriverHeartbeatInput!) {
        driverHeartbeat(input: $input) {
            ok
            serverTime
        }
    }
`;

export const START_DELIVERY_RIDE = `
    mutation StartDeliveryRide($orderId: ID!) {
        startDeliveryRide(orderId: $orderId) {
            ${RIDE_INFO_FIELDS}
        }
    }
`;

export const COMPLETE_DELIVERY_RIDE = `
    mutation CompleteDeliveryRide($orderId: ID!, $finalDistanceMeters: Int) {
        completeDeliveryRide(orderId: $orderId, finalDistanceMeters: $finalDistanceMeters) {
            ${RIDE_INFO_FIELDS}
        }
    }
`;

/** Driver's ride-streaming socket handshake ticket (60 s TTL, single-use). */
export const DRIVER_SOCKET_TICKET = `
    query DriverSocketTicket {
        driverSocketTicket
    }
`;

/** Fleet page — live status of every delivery person on the channel. */
export const DRIVER_STATUSES = `
    query DriverStatuses {
        driverStatuses {
            administratorId
            name
            phoneNumber
            state
            lat
            lng
            gpsOn
            lastHeartbeatAt
            metersToday
            activeOrderId
            activeOrderCode
        }
    }
`;

/** Fleet detail page — one driver's ride history in a date range. */
export const DRIVER_RIDES = `
    query DriverRides($deliveryPersonId: ID!, $dateFrom: DateTime!, $dateTo: DateTime!) {
        driverRides(deliveryPersonId: $deliveryPersonId, dateFrom: $dateFrom, dateTo: $dateTo) {
            ${RIDE_INFO_FIELDS}
        }
    }
`;

/** Fleet detail page — orders one driver held in a date range (assigned
 *  in it, closed in it, or still open), with their current state. */
export const DRIVER_ASSIGNED_ORDERS = `
    query DriverAssignedOrders($deliveryPersonId: ID!, $dateFrom: DateTime!, $dateTo: DateTime!) {
        driverAssignedOrders(deliveryPersonId: $deliveryPersonId, dateFrom: $dateFrom, dateTo: $dateTo) {
            fulfillmentId
            orderId
            orderCode
            state
            assignedAt
            deliveredAt
            customerName
            area
            orderTotal
        }
    }
`;
