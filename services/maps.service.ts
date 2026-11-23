/**
 * Maps service — client-side wrapper for the /api/maps/* route handlers.
 * The Routes API key never reaches the browser; see app/api/maps/route.
 */

import type { LatLng } from '@/lib/maps';
import { DEFAULT_VEHICLE, type Vehicle } from '@/lib/vehicle';

export interface RouteResult {
    distanceMeters: number;
    durationSeconds: number;
    encodedPolyline: string;
}

export async function fetchRoute(
    origin: LatLng,
    destination: LatLng,
    travelMode: Vehicle = DEFAULT_VEHICLE,
): Promise<RouteResult> {
    const res = await fetch('/api/maps/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ origin, destination, travelMode }),
    });
    if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `Route request failed (${res.status})`);
    }
    return (await res.json()) as RouteResult;
}
