import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy to the Google Routes API (computeRoutes).
 *
 * Exists so the Routes-capable key can stay off the client: the browser only
 * ever talks to this endpoint. Uses GOOGLE_MAPS_SERVER_KEY when set, falling
 * back to the shared NEXT_PUBLIC_GOOGLE_MAPS_KEY (current single-key setup).
 *
 * The field mask is required by the Routes API and also keeps billing on the
 * cheapest SKU tier — only ask for what the modal renders.
 */

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

interface RouteRequestBody {
    origin?: { lat?: number; lng?: number };
    destination?: { lat?: number; lng?: number };
    /** 'TWO_WHEELER' (default — delivery riders) or 'DRIVE' (van/car) */
    travelMode?: string;
}

function isValidPoint(p?: { lat?: number; lng?: number }): p is { lat: number; lng: number } {
    return (
        typeof p?.lat === 'number' &&
        typeof p?.lng === 'number' &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= -90 &&
        p.lat <= 90 &&
        p.lng >= -180 &&
        p.lng <= 180
    );
}

export async function POST(request: NextRequest) {
    const key = process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) {
        return NextResponse.json({ error: 'Google Maps key is not configured' }, { status: 500 });
    }

    // Cheap auth gate — same signal proxy.ts uses. Keeps anonymous
    // visitors from burning Routes API quota through this endpoint.
    if (!request.cookies.get('session')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: RouteRequestBody;
    try {
        body = (await request.json()) as RouteRequestBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { origin, destination } = body;
    if (!isValidPoint(origin) || !isValidPoint(destination)) {
        return NextResponse.json(
            { error: 'origin and destination must be { lat, lng } with valid coordinates' },
            { status: 400 },
        );
    }

    const res = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': FIELD_MASK,
            // The shared key is HTTP-referrer-restricted (browser key). Server
            // requests send no referer and get blocked, so present the app's
            // own origin — Google then applies the same allowlist as for the
            // browser. Both dev (localhost) and prod origins must be in the
            // key's allowed referrers.
            Referer: request.nextUrl.origin,
        },
        body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
            destination: {
                location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
            },
            // Riders are on two-wheelers unless the map's vehicle toggle says
            // car: Google routes bikes through lanes and cut-throughs cars
            // can't take, so DRIVE over-estimates for them (7.3 km vs the
            // 6.4 km Maps showed in two-wheeler mode). Anything unexpected in
            // the body falls back to two-wheeler.
            travelMode: body.travelMode === 'DRIVE' ? 'DRIVE' : 'TWO_WHEELER',
            routingPreference: 'TRAFFIC_AWARE',
        }),
    });

    if (!res.ok) {
        // Surface Google's real error message (API not enabled, key restricted…)
        const detail = await res.text().catch(() => '');
        console.error('[maps] Routes API error:', res.status, detail.slice(0, 500));
        return NextResponse.json(
            { error: `Routes API error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}` },
            { status: 502 },
        );
    }

    const data = (await res.json()) as {
        routes?: Array<{
            distanceMeters?: number;
            duration?: string; // "1234s"
            polyline?: { encodedPolyline?: string };
        }>;
    };
    const route = data.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
        return NextResponse.json({ error: 'No route found between these points' }, { status: 404 });
    }

    return NextResponse.json({
        distanceMeters: route.distanceMeters ?? 0,
        durationSeconds: parseInt(route.duration ?? '0', 10) || 0,
        encodedPolyline: route.polyline.encodedPolyline,
    });
}
