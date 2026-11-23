/**
 * Geo helpers + Google Maps JS loader for the delivery map feature.
 *
 * The math helpers are pure and safe to use anywhere (order-list distances,
 * the location provider) without pulling the maps bundle into every page.
 * Only `loadGoogleMaps()` touches the Google SDK — call it lazily from the
 * map modal so the script loads on demand.
 */

export interface LatLng {
    lat: number;
    lng: number;
}

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle (crow-flies) distance between two points, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** "850 m" under ~1 km, "3.2 km" above. Empty string for invalid input. */
export function formatDistance(meters: number): string {
    if (!Number.isFinite(meters) || meters < 0) return '';
    if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Extract the customer coordinates from an order shipping address.
 * Returns null when either coordinate is missing. Treats exact (0,0) as
 * missing — storefronts sometimes write zeros for "not set" — and rejects
 * out-of-range values.
 */
export function orderLatLng(
    addr?: {
        customFields?: { latitude?: number | null; longitude?: number | null } | null;
    } | null,
): LatLng | null {
    const lat = addr?.customFields?.latitude;
    const lng = addr?.customFields?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    if (lat === 0 && lng === 0) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

/** "14 min" / "1 h 05 min". Empty string for invalid input. */
export function formatEta(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const m = Math.round(seconds / 60);
    if (m < 1) return '1 min';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Move a point `distanceM` meters in compass direction `headingDeg`. */
export function offsetMeters(p: LatLng, headingDeg: number, distanceM: number): LatLng {
    const rad = (headingDeg * Math.PI) / 180;
    const dLat = (distanceM * Math.cos(rad)) / 110_574;
    const dLng = (distanceM * Math.sin(rad)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/**
 * Interpolate between two compass headings along the SHORTEST arc
 * (350° → 10° goes through 0°, not backwards through 180°).
 */
export function lerpHeading(fromDeg: number, toDeg: number, t: number): number {
    const delta = ((toDeg - fromDeg + 540) % 360) - 180;
    return (fromDeg + delta * t + 360) % 360;
}

/** Initial bearing from a to b, degrees clockwise from north (0–360). */
export function computeBearing(a: LatLng, b: LatLng): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─── Route-path math (snap-to-route + remaining distance) ────────────

/** suffix[i] = meters along the path from point i to the end. */
export function pathSuffixLengths(path: LatLng[]): number[] {
    const suffix = new Array<number>(path.length).fill(0);
    for (let i = path.length - 2; i >= 0; i--) {
        suffix[i] = suffix[i + 1] + haversineMeters(path[i], path[i + 1]);
    }
    return suffix;
}

export interface PathProjection {
    /** Nearest point ON the route — the marker is drawn here, not at the raw fix */
    snapped: LatLng;
    /** Perpendicular distance from the raw fix to the route */
    offRouteMeters: number;
    /** Distance left along the route from `snapped` to the destination */
    remainingMeters: number;
    segIndex: number;
}

/**
 * Project a GPS fix onto a route polyline. This is what keeps the driver
 * marker riding the road (instead of jittering through buildings) and what
 * lets the remaining-distance readout update every second with ZERO extra
 * Routes API calls.
 *
 * Uses a local equirectangular projection centred on the fix — accurate to
 * well under a meter at street scale, and far cheaper than spherical math
 * per segment.
 */
export function projectOntoPath(
    p: LatLng,
    path: LatLng[],
    suffixLengths: number[],
): PathProjection {
    const M_PER_DEG_LAT = 110_574;
    const mPerDegLng = 111_320 * Math.cos((p.lat * Math.PI) / 180);
    const toXY = (q: LatLng) => ({
        x: (q.lng - p.lng) * mPerDegLng,
        y: (q.lat - p.lat) * M_PER_DEG_LAT,
    });

    let best = { d2: Infinity, idx: 0, t: 0 };
    for (let i = 0; i < path.length - 1; i++) {
        const a = toXY(path[i]);
        const b = toXY(path[i + 1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        // t = position of the projection along the segment, clamped to [0,1]
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / len2));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const d2 = px * px + py * py;
        if (d2 < best.d2) best = { d2, idx: i, t };
    }

    const a = path[best.idx];
    const b = path[best.idx + 1];
    const snapped = {
        lat: a.lat + (b.lat - a.lat) * best.t,
        lng: a.lng + (b.lng - a.lng) * best.t,
    };
    return {
        snapped,
        offRouteMeters: Math.sqrt(best.d2),
        remainingMeters: haversineMeters(snapped, b) + (suffixLengths[best.idx + 1] ?? 0),
        segIndex: best.idx,
    };
}

// ─── Google Maps JS loader ───────────────────────────────────────────

let mapsLoadPromise: Promise<void> | null = null;

/**
 * Load the Google Maps JS SDK once (geometry + marker libraries included).
 * Subsequent calls return the same promise. Safe to call from any client
 * component — resolves immediately if already loaded.
 */
export function loadGoogleMaps(): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Google Maps can only load in the browser'));
    }
    const w = window as unknown as { google?: typeof google };
    if (w.google?.maps?.importLibrary) return Promise.resolve();
    if (mapsLoadPromise) return mapsLoadPromise;

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) {
        return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set'));
    }

    mapsLoadPromise = new Promise<void>((resolve, reject) => {
        const cbName = '__gmapsOnLoad';
        (window as unknown as Record<string, unknown>)[cbName] = () => resolve();
        const s = document.createElement('script');
        s.src =
            `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
            `&v=weekly&libraries=geometry,marker&loading=async&callback=${cbName}`;
        s.async = true;
        s.onerror = () => {
            mapsLoadPromise = null; // allow retry
            reject(new Error('Failed to load Google Maps — check the API key and that Maps JavaScript API is enabled'));
        };
        document.head.appendChild(s);
    });
    return mapsLoadPromise;
}

/** The Map ID for Advanced Markers — real one from env, demo fallback for dev. */
export function googleMapId(): string {
    return process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || 'DEMO_MAP_ID';
}

// ─── Vector-map safety net ───────────────────────────────────────────
//
// Google's VECTOR map (what a Map ID gives you: rotation, tilt, advanced
// markers) runs on WebGL and REFUSES weak or software-rendered WebGL —
// SwiftShader on low-end / GPU-blocklisted Android phones, Brave's
// deliberately degraded WebGL. On such devices the map came up as a blank
// grey panel while everything around it (header, ETA, buttons) worked:
// Google's own raster fallback raced the page's camera setup and never
// finished. Device-specific, not order-specific — hence "a few orders".
//
// Two layers: a PRE-FLIGHT check so known-bad devices get a RASTER map from
// the first frame, and a WATCHDOG that converts a vector map that hasn't
// drawn tiles within a few seconds. Advanced markers work on raster too;
// only the tilted/rotating camera becomes flat north-up.

const RASTER_FALLBACK_KEY = 'maps-raster-fallback-until';
/** A remembered fallback expires after this — GPUs/browsers do get updated */
const RASTER_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A vector map that hasn't drawn tiles by then (while visible) is not going to */
export const MAP_TILES_WATCHDOG_MS = 8_000;
/** After the switch, raster tiles this fast prove the network was fine and
 *  the vector renderer really was the problem — only then remember it */
const RASTER_PROOF_MS = 4_000;

/** Remember that the vector map failed on this device, so the next map
 *  starts raster instead of showing grey for another watchdog period. */
function rememberRasterFallback(): void {
    try {
        localStorage.setItem(RASTER_FALLBACK_KEY, String(Date.now() + RASTER_FALLBACK_TTL_MS));
    } catch { /* storage blocked — the watchdog still covers it */ }
}

function hasRememberedRasterFallback(): boolean {
    try {
        const until = Number(localStorage.getItem(RASTER_FALLBACK_KEY));
        return Number.isFinite(until) && until > Date.now();
    } catch {
        return false;
    }
}

/** True when this device can't be trusted with a vector map. */
export function preferRasterMap(): boolean {
    if (typeof document === 'undefined') return false;
    if (hasRememberedRasterFallback()) return true;
    // The app shell (Android WebView) used to be forced onto raster because
    // Chromium dropped the hidden page's WebGL context when the screen went
    // off — tiles stayed, route line and markers vanished. KeepAliveWebView
    // now keeps the page visible for the whole ride, so the vector map (and
    // with it the rotating, behind-the-rider camera) is back; the watchdog
    // and armVectorContextGuard below still convert a map that breaks.
    // Brave degrades WebGL on purpose (fingerprint "farbling"); the vector
    // map is the first thing that breaks. Its detection API is documented.
    if ('brave' in navigator) return true;
    try {
        const canvas = document.createElement('canvas');
        // failIfMajorPerformanceCaveat: the browser answers null when the
        // only WebGL it can offer is software-rendered — precisely what the
        // vector map rejects
        const opts = { failIfMajorPerformanceCaveat: true };
        const gl = (canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)) as
            | WebGLRenderingContext
            | null;
        if (!gl) return true;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(renderer);
    } catch {
        return true;
    }
}

/**
 * Convert a vector map that never draws tiles into a raster map. Attach
 * right after `new Map(...)`; returns a disposer for the effect cleanup.
 *
 * Only VISIBLE time counts — a hidden tab doesn't draw, so the clock pauses
 * while the rider is in another app. And a slow network must not be
 * mistaken for a broken renderer: the switch itself is cheap and always
 * done, but it is REMEMBERED for the device only if raster tiles then
 * arrive quickly (a slow network is slow for raster too).
 */
export function armRasterFallbackWatchdog(
    map: google.maps.Map,
    opts: { timeoutMs?: number; onFallback?: () => void } = {},
): () => void {
    if (map.getRenderingType() === 'RASTER') return () => {};
    const timeoutMs = opts.timeoutMs ?? MAP_TILES_WATCHDOG_MS;
    let settled = false;
    let remaining = timeoutMs;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const listener = google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        settled = true;
        stopTimer();
    });

    const fallBack = () => {
        if (settled) return;
        settled = true;
        google.maps.event.removeListener(listener);
        if (process.env.NODE_ENV !== 'production') {
            console.warn(`[maps] no tiles after ${timeoutMs} ms visible (${map.getRenderingType()}) — switching to RASTER`);
        }
        const switchedAt = Date.now();
        google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
            if (Date.now() - switchedAt <= RASTER_PROOF_MS) rememberRasterFallback();
        });
        // Harmless if Google already fell back on its own; the resize nudge
        // makes a stalled raster fallback finish drawing
        map.setRenderingType(google.maps.RenderingType.RASTER);
        google.maps.event.trigger(map, 'resize');
        opts.onFallback?.();
    };

    const startTimer = () => {
        if (settled || timer) return;
        startedAt = Date.now();
        timer = setTimeout(fallBack, remaining);
    };
    const stopTimer = () => {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const onVisibility = () => {
        if (document.visibilityState === 'visible') startTimer();
        else stopTimer();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') startTimer();

    return () => {
        settled = true;
        stopTimer();
        google.maps.event.removeListener(listener);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}

/** Time Chromium gets to restore a lost WebGL context before we give up on it */
const VECTOR_CONTEXT_GRACE_MS = 2_000;

/**
 * Safety net for a vector map that loses its WebGL context (memory
 * pressure, GPU reset, a long stay in the background): if the context is
 * still lost once the page is visible again — or a couple of seconds after
 * the browser reported the loss — switch to raster so the rider gets a
 * working map back instead of tiles with no route line or markers. The
 * fallback is remembered like the watchdog's, so the next map on this device
 * starts raster. Returns a disposer.
 */
export function armVectorContextGuard(map: google.maps.Map): () => void {
    if (map.getRenderingType() === 'RASTER') return () => {};
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let canvas: HTMLCanvasElement | null = null;

    const contextLost = (): boolean => {
        if (!canvas) return false;
        try {
            // getContext returns the context the map already created; a
            // mismatched type just answers null
            const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
                | WebGLRenderingContext
                | null;
            return !!gl && gl.isContextLost();
        } catch {
            return false;
        }
    };
    const check = () => {
        timer = null;
        if (disposed || map.getRenderingType() === 'RASTER' || !contextLost()) return;
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[maps] vector map lost its WebGL context — switching to RASTER');
        }
        rememberRasterFallback();
        map.setRenderingType(google.maps.RenderingType.RASTER);
        google.maps.event.trigger(map, 'resize');
    };
    const schedule = () => {
        if (disposed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(check, VECTOR_CONTEXT_GRACE_MS);
    };
    const onLost = () => schedule();
    const onVisibility = () => {
        if (document.visibilityState === 'visible') schedule();
    };
    // The renderer's canvas exists once the map has drawn its first frame
    const idle = google.maps.event.addListenerOnce(map, 'idle', () => {
        if (disposed) return;
        canvas = map.getDiv().querySelector('canvas');
        canvas?.addEventListener('webglcontextlost', onLost);
    });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
        google.maps.event.removeListener(idle);
        canvas?.removeEventListener('webglcontextlost', onLost);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
