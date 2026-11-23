/**
 * Shared flag: is the driver's ride-streaming socket currently connected?
 *
 * Set by useRideSocket, read by DriverLocationProvider's heartbeat sender —
 * while fixes stream over the socket (~every 2.5 s, and the backend stamps
 * presence from them), HTTP heartbeats are redundant and are skipped.
 * A module-level flag (not context) because the two live in different
 * component trees and this is a simple latest-value read.
 */

let rideStreamConnected = false;

export function setRideStreamConnected(connected: boolean): void {
    rideStreamConnected = connected;
}

export function isRideStreamConnected(): boolean {
    return rideStreamConnected;
}
