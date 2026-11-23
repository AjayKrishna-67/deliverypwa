/**
 * Ride odometer — client-side distance accumulator for the active delivery.
 *
 * Sums haversine distance between consecutive GOOD GPS fixes, persisted in
 * localStorage keyed by order id so a refresh or app restart never resets a
 * ride mid-way. The heartbeat reports the total CUMULATIVELY and the backend
 * keeps the max, so a lost ping loses nothing.
 *
 * Filters (why the number stays honest):
 *   · fixes with accuracy worse than 50 m don't move the anchor — GPS noise
 *     must not inflate km
 *   · implied speed over 40 m/s (144 km/h) is a GPS teleport, not driving
 *   · movements under 10 m don't count — standing still at a doorstep
 *     jitters by a few meters constantly
 */

import { haversineMeters } from '@/lib/maps';

const ODOMETER_KEY_PREFIX = 'ride-odometer:';

/** Deliberately tighter than PRECISE_ACCURACY_M in lib/gps-policy — km
 *  accumulation is far more noise-sensitive than map display. */
const MAX_FIX_ACCURACY_M = 50;
const MAX_SPEED_MPS = 40;
const MIN_SEGMENT_M = 10;

interface OdometerState {
    meters: number;
    lat: number;
    lng: number;
    ts: number;
}

export interface OdometerFix {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
}

function key(orderId: string): string {
    return `${ODOMETER_KEY_PREFIX}${orderId}`;
}

function readState(orderId: string): OdometerState | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key(orderId));
        if (!raw) return null;
        const s = JSON.parse(raw) as OdometerState;
        if (typeof s?.meters !== 'number' || typeof s?.lat !== 'number') return null;
        return s;
    } catch {
        return null;
    }
}

function writeState(orderId: string, state: OdometerState): void {
    try {
        localStorage.setItem(key(orderId), JSON.stringify(state));
    } catch {
        // storage full/blocked — the ride still works, km just stops growing
    }
}

/** Current cumulative meters for the ride (0 when never started). */
export function readOdometerMeters(orderId: string): number {
    return Math.round(readState(orderId)?.meters ?? 0);
}

/**
 * Seed the odometer with a known cumulative total (the backend's stored ride
 * km) — used on ride RESUME after logout wiped local state, so counting
 * continues from where the backend left off instead of restarting at zero
 * (a fresh count below the server's GREATEST would silently never register).
 * ts: -1 marks "meters known, anchor pending" — the next GPS fix becomes the
 * anchor without adding a phantom segment.
 */
export function seedOdometerMeters(orderId: string, meters: number): void {
    if (!Number.isFinite(meters) || meters <= 0) return;
    const current = readState(orderId);
    if (current && current.meters >= meters) return; // local already ahead
    writeState(orderId, { meters: Math.round(meters), lat: 0, lng: 0, ts: -1 });
}

/**
 * Fold a new GPS fix into the ride's odometer. Returns the new total.
 * Call for every accepted fix while a delivery is active.
 */
export function accumulateOdometer(orderId: string, fix: OdometerFix): number {
    const state = readState(orderId);
    if (!state) {
        // First fix of the ride — anchor only, nothing traveled yet. A rough
        // (cell-tower) fix must not become the anchor: the first good fix
        // after it would read as kilometres "driven" from the wrong spot.
        if (fix.accuracy > MAX_FIX_ACCURACY_M) return 0;
        writeState(orderId, { meters: 0, lat: fix.lat, lng: fix.lng, ts: fix.timestamp });
        return 0;
    }
    if (state.ts < 0) {
        // Seeded total waiting for its first anchor (post-resume): adopt this
        // fix as the anchor, keep the seeded meters, add no segment
        if (fix.accuracy > MAX_FIX_ACCURACY_M) return Math.round(state.meters);
        writeState(orderId, { meters: state.meters, lat: fix.lat, lng: fix.lng, ts: fix.timestamp });
        return Math.round(state.meters);
    }
    if (fix.accuracy > MAX_FIX_ACCURACY_M) {
        return Math.round(state.meters); // bad fix — anchor stays put
    }
    const dtSec = (fix.timestamp - state.ts) / 1000;
    if (dtSec <= 0) {
        return Math.round(state.meters);
    }
    const d = haversineMeters({ lat: state.lat, lng: state.lng }, { lat: fix.lat, lng: fix.lng });
    if (d / dtSec > MAX_SPEED_MPS) {
        // Teleport — skip the segment but move the anchor so one glitched fix
        // doesn't poison every following segment with an impossible baseline
        writeState(orderId, { meters: state.meters, lat: fix.lat, lng: fix.lng, ts: fix.timestamp });
        return Math.round(state.meters);
    }
    if (d < MIN_SEGMENT_M) {
        return Math.round(state.meters); // jitter — anchor stays until real movement
    }
    const next: OdometerState = {
        meters: state.meters + d,
        lat: fix.lat,
        lng: fix.lng,
        ts: fix.timestamp,
    };
    writeState(orderId, next);
    return Math.round(next.meters);
}

export function clearOdometer(orderId: string): void {
    try {
        localStorage.removeItem(key(orderId));
    } catch { /* non-critical */ }
}

/** Wipe every ride odometer — call on logout (shared handsets). */
export function clearAllOdometers(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(ODOMETER_KEY_PREFIX)) localStorage.removeItem(k);
        }
    } catch { /* non-critical */ }
}
