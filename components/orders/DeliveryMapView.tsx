'use client';

/**
 * DeliveryMapView — the full-screen delivery map, rendered by the
 * /delivery/[orderId] page (this is a PAGE flow, not a modal).
 *
 * PREVIEW phase (order not yet out for delivery — NO state change happened):
 *   · map with customer pin + driver pin + driving route line, distance, ETA
 *   · bottom bar: [Cancel] [Start] — Cancel/back returns to the orders list
 *
 * START → the page runs the real transition and derives phase from the
 * order state, flipping this view to ACTIVE:
 *   · no back UI; the Android/browser back button is trapped (popstate
 *     re-push) — the page exits only when the order reaches a terminal state
 *   · screen wake lock so GPS stays alive
 *   · live tracking: every GPS fix snaps to the route line, the marker
 *     glides there (rAF lerp) and rotates to the heading; remaining distance
 *     recomputes locally — ZERO API calls per tick
 *   · off the route by >60 m for 2 fixes → ONE Routes API recompute
 *     (min 20 s apart)
 *   · bottom bar: [Delivered] only → the page opens PaymentCollectionModal
 *
 * Phase is CONTROLLED by the page (derived from order state), so a refresh
 * lands back in the right phase automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDriverLocation } from '@/providers/DriverLocationProvider';
import { fetchRoute } from '@/services/maps.service';
import {
    loadGoogleMaps,
    googleMapId,
    preferRasterMap,
    armRasterFallbackWatchdog,
    armVectorContextGuard,
    haversineMeters,
    formatDistance,
    formatEta,
    projectOntoPath,
    pathSuffixLengths,
    computeBearing,
    offsetMeters,
    lerpHeading,
    type LatLng,
} from '@/lib/maps';
import { DELIVER_BUTTON_STYLE, OUT_FOR_DELIVERY_BUTTON_STYLE } from '@/lib/constants';
import {
    ARRIVAL_MAX_ACCURACY_M,
    ROUTE_ORIGIN_MAX_ACCURACY_M,
    formatAccuracy,
    gpsWaitMessage,
    isPreciseFix,
} from '@/lib/gps-policy';
import { SpinnerIcon, CheckIcon, TruckIcon } from '@/components/icons';
import { readVehicle, type Vehicle } from '@/lib/vehicle';
import { EnableLocationHelp } from '@/components/location/EnableLocationHelp';
import type { DeliveryOrder } from '@/services/orders.service';

// ─── Tuning ──────────────────────────────────────────────────────────
const OFF_ROUTE_THRESHOLD_M = 60;
const OFF_ROUTE_MIN_FIXES = 2;
const ROUTE_REFETCH_MIN_INTERVAL_MS = 20_000;
// Preview: how far the rider may sit from the point the route was planned
// from before it is re-planned (the first fix is often a Wi-Fi/cell point
// 100–300 m off, or the rider moves before tapping Start)
const PREVIEW_ORIGIN_DRIFT_M = 60;
const ARRIVAL_THRESHOLD_M = 50;
const MARKER_ANIM_MS = 700;
// Rider practically on top of the customer: Google returns a degenerate
// one-point route for such a hop, so below this we draw a straight line
// instead of reporting a routing failure.
const SHORT_HOP_MAX_M = 250;

// Navigation camera (Google-Maps-style, entered on Start):
// zoomed to the rider, rotated so the road ahead points up, with the camera
// centred slightly AHEAD of the rider — i.e. sitting behind the icon.
// NAV_TILT 0 = flat 2D top-down view; raising it (e.g. 45) gives the tilted
// perspective but the vector map then draws 3D buildings.
const NAV_ZOOM = 17.5;
const NAV_TILT = 10;
const NAV_AHEAD_M = 60;
const NAV_FLY_IN_MS = 900;

type Phase = 'preview' | 'active';

/** RouteResult + the decoded path & suffix lengths, kept together in state */
interface RouteState {
    distanceMeters: number;
    durationSeconds: number;
    path: LatLng[];
    suffix: number[];
}

interface DeliveryMapViewProps {
    order: DeliveryOrder;
    /** Derived by the page from the order state — refresh-safe */
    phase: Phase;
    /** Page policy: a fix fresher than 30 s exists. Start needs it, so the
     *  button and the GPS strip follow this rather than "has any fix" —
     *  otherwise Start could look enabled while the page ignores the tap. */
    gpsLive: boolean;
    /** Runs the real OutforDelivery transition. Must throw on failure. */
    onStart: () => Promise<void>;
    /** Opens the payment/delivered flow (PaymentCollectionModal) */
    onDeliver: () => void;
    /** Leave the page — offered in preview phase only */
    onBack: () => void;
}

export function DeliveryMapView({ order, phase, gpsLive, onStart, onDeliver, onBack }: DeliveryMapViewProps) {
    const { status: gpsStatus, position, requestPermission, retryGps, fixIssue } = useDriverLocation();
    const [showHelp, setShowHelp] = useState(false);

    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState('');
    const [route, setRoute] = useState<RouteState | null>(null);
    const [routeError, setRouteError] = useState('');
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState('');
    // Auto-follow: true while the camera rides behind the rider. Dragging
    // the map pauses it (Google-nav behaviour) and shows the recenter button.
    const [following, setFollowing] = useState(true);
    // Route vehicle (bike/car) — chosen with the header switch, remembered
    // per phone; read once when the map opens. Changes only the planned
    // route + estimate, never the credited km.
    const vehicleRef = useRef<Vehicle>(readVehicle());

    // Destination — memoized on the primitive values so a re-fetched order
    // object (new identity, same coords) doesn't re-init the map
    const destLat = order.shippingAddress?.customFields?.latitude;
    const destLng = order.shippingAddress?.customFields?.longitude;
    const dest = useMemo<LatLng | null>(() => {
        if (typeof destLat !== 'number' || typeof destLng !== 'number') return null;
        if (destLat === 0 && destLng === 0) return null;
        return { lat: destLat, lng: destLng };
    }, [destLat, destLng]);

    // Map object refs — imperative Google Maps world, not React state
    const mapDivRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const driverMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
    const driverArrowRef = useRef<HTMLDivElement | null>(null);
    const polylineRef = useRef<google.maps.Polyline | null>(null);
    const polylineCasingRef = useRef<google.maps.Polyline | null>(null);
    const renderedPosRef = useRef<LatLng | null>(null);
    const animFrameRef = useRef(0);
    const camAnimRef = useRef(0);
    const fitDoneRef = useRef(false);
    const mapWatchdogStopRef = useRef<(() => void) | null>(null);
    const fetchingRef = useRef(false);
    const lastFetchAtRef = useRef(0);
    // Accuracy of the fix the current route was drawn from — a route from a
    // coarse start is redrawn once a precise fix lands
    const routeOriginAccuracyRef = useRef<number | null>(null);
    // Where the current route was planned from — preview re-plans when the
    // rider drifts away from it (the line must start at the rider)
    const routeOriginRef = useRef<LatLng | null>(null);
    const offRouteCountRef = useRef(0);
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    // Navigation-camera state (all screen-space math, never React state)
    const lastHeadingRef = useRef<number | null>(null); // last known travel heading
    const mapHeadingRef = useRef(0);                    // heading currently applied to the map
    const navEnteredRef = useRef(false);                // fly-in ran once
    const flyingRef = useRef(false);                    // camera flight in progress
    const followingRef = useRef(true);                  // mirrors `following` for rAF loops
    const positionRef = useRef(position);
    positionRef.current = position;
    const phaseRef = useRef(phase);
    phaseRef.current = phase;

    const customerName = order.customer
        ? `${order.customer.firstName} ${order.customer.lastName}`
        : (order.shippingAddress?.fullName ?? 'Customer');
    const addressLine = [
        order.shippingAddress?.streetLine1,
        order.shippingAddress?.streetLine2,
        order.shippingAddress?.city,
        order.shippingAddress?.province,
        order.shippingAddress?.postalCode,
    ]
        .filter(Boolean)
        .join(', ');

    // ── Derived navigation state — pure render math, no effects ───────
    const nav = useMemo(() => {
        if (!dest) return null;
        if (!position) {
            return route
                ? { remaining: route.distanceMeters, eta: route.durationSeconds, snapped: null as LatLng | null, offRoute: false, segIndex: null as number | null, approx: false }
                : null;
        }
        const pos = { lat: position.lat, lng: position.lng };
        const etaFor = (remaining: number) =>
            route && route.distanceMeters > 0
                ? Math.round(route.durationSeconds * (remaining / route.distanceMeters))
                : null;
        if (!isPreciseFix(position.accuracy)) {
            // Coarse (cell/Wi-Fi) fix: still give the rider a number, marked
            // "≈". Projecting the rough point onto the route keeps the
            // estimate close to real progress (no jump to the full route
            // length when a basement swallows the signal mid-ride), but
            // never snap the marker to it and never call it off-route —
            // a 600 m-wide point is "on" every nearby road.
            if (route && route.path.length >= 2) {
                const proj = projectOntoPath(pos, route.path, route.suffix);
                return { remaining: proj.remainingMeters, eta: etaFor(proj.remainingMeters), snapped: null as LatLng | null, offRoute: false, segIndex: null as number | null, approx: true };
            }
            return { remaining: haversineMeters(pos, dest), eta: null, snapped: null as LatLng | null, offRoute: false, segIndex: null as number | null, approx: true };
        }
        if (route && route.path.length >= 2) {
            const proj = projectOntoPath(pos, route.path, route.suffix);
            if (proj.offRouteMeters <= OFF_ROUTE_THRESHOLD_M) {
                return { remaining: proj.remainingMeters, eta: etaFor(proj.remainingMeters), snapped: proj.snapped, offRoute: false, segIndex: proj.segIndex, approx: false };
            }
            return { remaining: haversineMeters(pos, dest), eta: null, snapped: null, offRoute: true, segIndex: null, approx: false };
        }
        return { remaining: haversineMeters(pos, dest), eta: null, snapped: null, offRoute: false, segIndex: null, approx: false };
    }, [position, route, dest]);

    // Arrival needs a tight fix — a rough one can land "within 50 m" by luck
    const arrived =
        phase === 'active' &&
        nav != null &&
        nav.remaining != null &&
        nav.remaining <= ARRIVAL_THRESHOLD_M &&
        position != null &&
        position.accuracy <= ARRIVAL_MAX_ACCURACY_M;

    // How long the map has waited for a LIVE fix. Chromium reports a watch
    // timeout at most once, so after 20 s the strip switches from
    // "getting…" to advice on its own clock.
    // (Ticks exactly while the strip's "granted" branch can render.)
    const waitingForGps = gpsStatus === 'granted' && (!position || (phase === 'preview' && !gpsLive));
    const [clock, setClock] = useState({ waitedMs: 0, now: 0 });
    useEffect(() => {
        if (!waitingForGps) {
            const t0 = setTimeout(() => setClock({ waitedMs: 0, now: 0 }), 0);
            return () => clearTimeout(t0);
        }
        const start = Date.now();
        const t = setInterval(() => {
            const now = Date.now();
            setClock({ waitedMs: now - start, now });
        }, 1_000);
        return () => clearInterval(t);
    }, [waitingForGps]);

    // ── Map init (once) ───────────────────────────────────────────────
    useEffect(() => {
        if (!dest) return;
        let disposed = false;
        (async () => {
            try {
                await loadGoogleMaps();
                if (disposed || !mapDivRef.current) return;
                const [mapsLib, markerLib] = await Promise.all([
                    google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
                    google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
                    google.maps.importLibrary('geometry'),
                ]);
                if (disposed || !mapDivRef.current) return;

                const map = new mapsLib.Map(mapDivRef.current, {
                    mapId: googleMapId(),
                    // Weak/software WebGL can't run the vector map — start
                    // raster there instead of showing a grey panel (see
                    // lib/maps.ts). The watchdog below covers phones that
                    // pass the check but still never draw.
                    ...(preferRasterMap() ? { renderingType: google.maps.RenderingType.RASTER } : {}),
                    center: dest,
                    zoom: 15,
                    disableDefaultUI: true,
                    // Zoom +/− top-right, away from the recenter button's
                    // bottom-right corner (phones mostly pinch anyway)
                    zoomControl: true,
                    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
                    gestureHandling: 'greedy',
                    clickableIcons: false,
                });
                mapRef.current = map;
                const stopWatchdog = armRasterFallbackWatchdog(map);
                const stopContextGuard = armVectorContextGuard(map);
                // Coming back from the background (screen off / app switch) a
                // WebView map can stop repainting its overlays. A resize nudge
                // + re-centre makes Maps redraw everything it still holds.
                const onVisible = () => {
                    if (document.visibilityState !== 'visible' || !mapRef.current) return;
                    const m = mapRef.current;
                    const c = m.getCenter();
                    google.maps.event.trigger(m, 'resize');
                    if (c) m.setCenter(c);
                };
                document.addEventListener('visibilitychange', onVisible);
                mapWatchdogStopRef.current = () => {
                    stopWatchdog();
                    stopContextGuard();
                    document.removeEventListener('visibilitychange', onVisible);
                };

                // Customer pin (red)
                const pin = new markerLib.PinElement({
                    scale: 1.15,
                    background: '#ef4444',
                    borderColor: '#b91c1c',
                    glyphColor: '#fff',
                });
                new markerLib.AdvancedMarkerElement({ map, position: dest, content: pin.element });

                // Driver marker — top-view RIDER (scooter) badge with a
                // direction beak, rotated to the travel heading.
                // Outer div re-anchors the visual centre onto the lat/lng
                // (AdvancedMarker anchors bottom-centre); inner div rotates
                // around that centre so the rider spins in place.
                const outer = document.createElement('div');
                outer.style.cssText = 'transform:translateY(50%);';
                const wrap = document.createElement('div');
                wrap.style.cssText =
                    'width:44px;height:44px;display:flex;align-items:center;justify-content:center;' +
                    'transition:transform 0.3s linear;transform-origin:center;' +
                    'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.45));';
                wrap.innerHTML =
                    '<svg width="44" height="44" viewBox="0 0 44 44">' +
                    // direction beak (peeks out above the badge)
                    '<path d="M22 0 L28.5 9 L15.5 9 Z" fill="#6366f1"/>' +
                    // white badge
                    '<circle cx="22" cy="23" r="19" fill="#fff" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>' +
                    // scooter, top view, pointing up: front wheel · handlebar · deck · helmet · rear wheel
                    '<rect x="19.5" y="9.5" width="5" height="8" rx="2.5" fill="#263043"/>' +
                    '<rect x="13" y="16.5" width="18" height="3.2" rx="1.6" fill="#263043"/>' +
                    '<rect x="16.5" y="18" width="11" height="15" rx="5" fill="#6366f1" stroke="#fff" stroke-width="1.5"/>' +
                    '<circle cx="22" cy="26.5" r="4.6" fill="#22c55e" stroke="#fff" stroke-width="1.5"/>' +
                    '<rect x="19.5" y="33.5" width="5" height="6.5" rx="2.5" fill="#263043"/>' +
                    '</svg>';
                outer.appendChild(wrap);
                driverArrowRef.current = wrap;
                driverMarkerRef.current = new markerLib.AdvancedMarkerElement({
                    map,
                    content: outer,
                    zIndex: 10,
                });
                if (!disposed) setMapReady(true);
            } catch (e) {
                if (!disposed) setMapError(e instanceof Error ? e.message : 'Failed to load Google Maps');
            }
        })();
        return () => {
            disposed = true;
            mapWatchdogStopRef.current?.();
            mapWatchdogStopRef.current = null;
            cancelAnimationFrame(animFrameRef.current);
            cancelAnimationFrame(camAnimRef.current);
        };
    }, [dest]);

    // ── Route fetch (initial + off-route recompute + Retry) ───────────
    // No setState before the first await → compliant with the effect rules.
    const fetchRouteNow = useCallback(async (origin: LatLng, destination: LatLng) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        lastFetchAtRef.current = Date.now();
        routeOriginRef.current = origin;
        try {
            const r = await fetchRoute(origin, destination, vehicleRef.current);
            let decoded = google.maps.geometry.encoding
                .decodePath(r.encodedPolyline)
                .map((p) => ({ lat: p.lat(), lng: p.lng() }));
            const straightLine = haversineMeters(origin, destination);
            if (decoded.length < 2) {
                // The customer is already at the rider's feet: both points snap
                // to the same spot on the same road and Google answers with a
                // single-point polyline. There is nothing to route — draw the
                // last few metres as a straight line so the rider still gets a
                // map, a distance and the Delivered button.
                if (straightLine > SHORT_HOP_MAX_M) {
                    setRouteError('No route found');
                    return;
                }
                decoded = [origin, destination];
            }
            if (mapRef.current) {
                // Draw (or refresh) the route the driver follows — bold,
                // Google-style: a dark casing underneath + the main line on top
                if (!polylineRef.current) {
                    polylineCasingRef.current = new google.maps.Polyline({
                        map: mapRef.current,
                        path: decoded,
                        strokeColor: '#312e81',
                        strokeOpacity: 1,
                        strokeWeight: 12,
                        zIndex: 1,
                    });
                    polylineRef.current = new google.maps.Polyline({
                        map: mapRef.current,
                        path: decoded,
                        strokeColor: '#6366f1',
                        strokeOpacity: 1,
                        strokeWeight: 8,
                        zIndex: 2,
                    });
                } else {
                    polylineCasingRef.current?.setPath(decoded);
                    polylineRef.current.setPath(decoded);
                }
                if (!fitDoneRef.current) {
                    fitDoneRef.current = true;
                    // Preview only: frame the whole route. In ACTIVE phase
                    // (refresh mid-delivery) the nav fly-in owns the camera —
                    // this fetch resolves AFTER the fly-in and fitBounds would
                    // stomp the nav pose back to a zoomed-out north-up view.
                    if (phaseRef.current === 'preview') {
                        const b = new google.maps.LatLngBounds();
                        b.extend(origin);
                        b.extend(destination);
                        decoded.forEach((pt) => b.extend(pt));
                        mapRef.current.fitBounds(b, { top: 90, bottom: 190, left: 48, right: 48 });
                    }
                }
            }
            setRoute({
                // A short hop reports 0 m from Google — show the real gap
                distanceMeters: r.distanceMeters || Math.round(straightLine),
                durationSeconds: r.durationSeconds,
                path: decoded,
                suffix: pathSuffixLengths(decoded),
            });
            setRouteError('');
        } catch (e) {
            setRouteError(e instanceof Error ? e.message : 'Could not get the route');
        } finally {
            fetchingRef.current = false;
        }
    }, []);

    // First route as soon as map + GPS are both ready — but not from a
    // multi-km cell fix: a route from the wrong side of town misleads more
    // than an empty map (the strip explains the wait)
    useEffect(() => {
        if (!mapReady || !dest || !position || route || routeError || fetchingRef.current) return;
        if (position.accuracy > ROUTE_ORIGIN_MAX_ACCURACY_M) return;
        routeOriginAccuracyRef.current = position.accuracy;
        fetchRouteNow({ lat: position.lat, lng: position.lng }, dest);
    }, [mapReady, dest, position, route, routeError, fetchRouteNow]);

    // A route drawn from a coarse start is redrawn ONCE from the first
    // precise fix (fetchingRef prevents overlap; the ref flips so it runs once)
    useEffect(() => {
        if (!route || !position || !dest || fetchingRef.current) return;
        const originAcc = routeOriginAccuracyRef.current;
        if (originAcc == null || isPreciseFix(originAcc) || !isPreciseFix(position.accuracy)) return;
        routeOriginAccuracyRef.current = position.accuracy;
        // The first frame was computed for the wrong start — frame again
        // (fetchRouteNow only fits in preview; active keeps the nav pose)
        fitDoneRef.current = false;
        fetchRouteNow({ lat: position.lat, lng: position.lng }, dest);
    }, [route, position, dest, fetchRouteNow]);

    // ── Camera flight: animate to the nav pose — zoomed to the rider,
    //    slight tilt, road ahead pointing up, camera behind the icon.
    //    Shared by the Start fly-in and the Recenter button. ──────────────
    const flyCameraTo = useCallback((ms: number) => {
        const map = mapRef.current;
        const pos = positionRef.current;
        const cur = renderedPosRef.current ?? (pos ? { lat: pos.lat, lng: pos.lng } : null);
        if (!map || !cur) return;
        // On a RASTER map (weak-WebGL fallback) heading/tilt are ignored by
        // Google — keep our own map-heading at 0 so the rider icon, which
        // rotates by (travel − map heading), still points the right way
        const vector = map.getRenderingType() !== 'RASTER';
        const travel = lastHeadingRef.current ?? mapHeadingRef.current;
        const h = vector ? travel : 0;
        flyingRef.current = true;

        const c = map.getCenter();
        const from = {
            center: c ? { lat: c.lat(), lng: c.lng() } : cur,
            zoom: map.getZoom() ?? NAV_ZOOM,
            heading: map.getHeading() ?? 0,
            tilt: map.getTilt() ?? 0,
        };
        const targetCenter = offsetMeters(cur, travel, NAV_AHEAD_M);
        const t0 = performance.now();
        const stepCam = (now: number) => {
            const t = Math.min(1, (now - t0) / ms);
            const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
            const hh = lerpHeading(from.heading, h, e);
            mapHeadingRef.current = hh;
            map.moveCamera({
                center: {
                    lat: from.center.lat + (targetCenter.lat - from.center.lat) * e,
                    lng: from.center.lng + (targetCenter.lng - from.center.lng) * e,
                },
                zoom: from.zoom + (NAV_ZOOM - from.zoom) * e,
                tilt: vector ? from.tilt + (NAV_TILT - from.tilt) * e : 0,
                heading: hh,
            });
            // Keep the rider pointing at its real heading in screen space
            if (driverArrowRef.current) {
                driverArrowRef.current.style.transform =
                    `rotate(${Math.round((lastHeadingRef.current ?? 0) - hh)}deg)`;
            }
            if (t < 1) {
                camAnimRef.current = requestAnimationFrame(stepCam);
            } else {
                flyingRef.current = false;
            }
        };
        cancelAnimationFrame(camAnimRef.current);
        camAnimRef.current = requestAnimationFrame(stepCam);
    }, []);

    // ── Entering ACTIVE: run the fly-in once ──────────────────────────
    // (A coarse fix would fly the camera to a point kilometres off — wait.)
    const hasPreciseFix = position != null && isPreciseFix(position.accuracy);
    useEffect(() => {
        if (phase !== 'active' || !mapReady || !hasPreciseFix || navEnteredRef.current) return;
        const pos = positionRef.current;
        if (!mapRef.current || !pos) return;
        navEnteredRef.current = true;

        // Best-known travel heading: GPS → last movement → route direction → north
        let h = pos.heading ?? lastHeadingRef.current;
        if (h == null && route && route.path.length >= 2) {
            const proj = projectOntoPath({ lat: pos.lat, lng: pos.lng }, route.path, route.suffix);
            h = computeBearing(route.path[proj.segIndex], route.path[Math.min(proj.segIndex + 1, route.path.length - 1)]);
        }
        lastHeadingRef.current = h ?? 0;
        flyCameraTo(NAV_FLY_IN_MS);
        // No cleanup here on purpose: reruns are guarded by navEnteredRef and
        // cancelling would kill the flight; unmount cancel lives in map init.
    }, [phase, mapReady, hasPreciseFix, route, flyCameraTo]);

    // ── Manual drag pauses auto-follow (Google-nav behaviour) ─────────
    useEffect(() => {
        if (!mapReady) return;
        const map = mapRef.current;
        if (!map) return;
        const listener = map.addListener('dragstart', () => {
            if (phaseRef.current !== 'active') return; // preview panning is free
            followingRef.current = false;
            setFollowing(false);
        });
        return () => listener.remove();
    }, [mapReady]);

    // ── Recenter: resume following and fly back behind the rider ──────
    function handleRecenter() {
        followingRef.current = true;
        setFollowing(true);
        flyCameraTo(600);
    }

    // ── Live marker movement — pure external updates, no setState ─────
    useEffect(() => {
        if (!mapReady || !position || !dest) return;
        const marker = driverMarkerRef.current;
        if (!marker) return;

        const raw = { lat: position.lat, lng: position.lng };
        // A coarse fix (±km) must not drag the icon or the camera across
        // town: place the marker once so the rider sees something, then
        // hold until a precise fix. renderedPosRef stays untouched on
        // purpose — it means "last GOOD rendered point": the fly-in and the
        // heading-from-movement logic read it, and a cell-tower point there
        // would fly the camera and spin the icon toward nowhere.
        if (!isPreciseFix(position.accuracy)) {
            if (!renderedPosRef.current && !marker.position) marker.position = raw;
            offRouteCountRef.current = 0;
            return;
        }
        const target = nav?.snapped ?? raw;

        // Heading: GPS-reported, else bearing from the last rendered point
        const prev = renderedPosRef.current;
        let heading = position.heading;
        if (heading == null && prev && haversineMeters(prev, target) > 3) {
            heading = computeBearing(prev, target);
        }
        if (heading != null) lastHeadingRef.current = heading;

        /** Trim the traveled route: the line starts AT the rider and shrinks
         *  toward the destination as it moves (Google-nav behaviour). Only
         *  while on-route in active phase; a route refetch redraws in full
         *  and the next fix resumes trimming. */
        const restOfPath =
            phase === 'active' && route && nav?.snapped && nav.segIndex != null
                ? route.path.slice(nav.segIndex + 1)
                : null;
        const trimRouteLine = (cur: LatLng) => {
            if (!restOfPath) return;
            const remainingPath = [cur, ...restOfPath];
            polylineRef.current?.setPath(remainingPath);
            polylineCasingRef.current?.setPath(remainingPath);
        };

        /** Rotate the rider icon; in nav mode the map itself is rotated, so
         *  the icon's screen rotation is (travel heading − map heading). */
        const rotateRider = () => {
            if (!driverArrowRef.current) return;
            const base = lastHeadingRef.current ?? 0;
            // A raster map (weak-WebGL fallback) never rotates, whatever
            // mapHeadingRef last recorded before a mid-ride switch
            const mapH =
                phase === 'active' && mapRef.current?.getRenderingType() !== 'RASTER'
                    ? mapHeadingRef.current
                    : 0;
            driverArrowRef.current.style.transform = `rotate(${Math.round(base - mapH)}deg)`;
        };

        /** Google-nav camera follow: heading eases toward the travel heading,
         *  centre sits NAV_AHEAD_M ahead → the camera rides behind the rider.
         *  Paused while the driver has dragged away (recenter resumes it). */
        const followCamera = (cur: LatLng) => {
            if (phase !== 'active' || flyingRef.current || !followingRef.current) return;
            const travel = lastHeadingRef.current ?? mapHeadingRef.current;
            // Raster fallback: the map never rotates, so our map-heading
            // stays 0 (keeps the icon rotation honest) while the camera
            // still leads along the travel direction
            const vector = mapRef.current?.getRenderingType() !== 'RASTER';
            const hh = vector ? lerpHeading(mapHeadingRef.current, travel, 0.15) : 0;
            mapHeadingRef.current = hh;
            mapRef.current?.moveCamera({
                center: offsetMeters(cur, vector ? hh : travel, NAV_AHEAD_M),
                heading: hh,
            });
        };

        // Glide prev → target instead of teleporting
        cancelAnimationFrame(animFrameRef.current);
        if (!prev) {
            marker.position = target;
            renderedPosRef.current = target;
            rotateRider();
            followCamera(target);
            trimRouteLine(target);
        } else {
            const from = { ...prev };
            const startTs = performance.now();
            const step = (now: number) => {
                const t = Math.min(1, (now - startTs) / MARKER_ANIM_MS);
                const cur = {
                    lat: from.lat + (target.lat - from.lat) * t,
                    lng: from.lng + (target.lng - from.lng) * t,
                };
                marker.position = cur;
                renderedPosRef.current = cur;
                followCamera(cur);
                rotateRider();
                trimRouteLine(cur);
                if (t < 1) animFrameRef.current = requestAnimationFrame(step);
            };
            animFrameRef.current = requestAnimationFrame(step);
        }

        // Off-route (active) or drifted from the planned start (preview)
        // → sustained → throttled recompute. Preview has no trimming, so a
        // route planned from a stale first fix visibly starts away from the
        // rider until it is re-planned from where they actually are.
        const origin = routeOriginRef.current;
        const driftedInPreview =
            phase === 'preview' &&
            route != null &&
            origin != null &&
            haversineMeters(raw, origin) > Math.max(PREVIEW_ORIGIN_DRIFT_M, position.accuracy);
        if ((phase === 'active' && nav?.offRoute) || driftedInPreview) {
            offRouteCountRef.current += 1;
            if (
                offRouteCountRef.current >= OFF_ROUTE_MIN_FIXES &&
                Date.now() - lastFetchAtRef.current > ROUTE_REFETCH_MIN_INTERVAL_MS
            ) {
                offRouteCountRef.current = 0;
                routeOriginAccuracyRef.current = position.accuracy;
                // Preview: frame the re-planned route from the new start
                if (driftedInPreview) fitDoneRef.current = false;
                fetchRouteNow(raw, dest);
            }
        } else {
            offRouteCountRef.current = 0;
        }
    }, [position, nav, route, mapReady, dest, phase, fetchRouteNow]);

    // ── ACTIVE phase: trap the Android/browser back button ────────────
    useEffect(() => {
        if (phase !== 'active') return;
        history.pushState(null, '', window.location.href);
        const onPop = () => history.pushState(null, '', window.location.href);
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [phase]);

    // ── ACTIVE phase: keep the screen (and GPS) awake ─────────────────
    useEffect(() => {
        if (phase !== 'active' || !('wakeLock' in navigator)) return;
        let released = false;
        const acquire = async () => {
            try {
                wakeLockRef.current = await navigator.wakeLock.request('screen');
            } catch {
                // Low battery / unsupported — non-critical
            }
        };
        acquire();
        const onVis = () => {
            if (document.visibilityState === 'visible' && !released) acquire();
        };
        document.addEventListener('visibilitychange', onVis);
        return () => {
            released = true;
            document.removeEventListener('visibilitychange', onVis);
            wakeLockRef.current?.release().catch(() => {});
            wakeLockRef.current = null;
        };
    }, [phase]);

    // ── Start (single handler — with GPS it tracks, without it the page
    //    stays here in active phase showing "tracking unavailable") ─────
    async function handleStart() {
        if (starting) return;
        setStarting(true);
        setStartError('');
        try {
            await onStart();
        } catch (e) {
            setStartError(e instanceof Error ? e.message : 'Failed to start delivery');
        } finally {
            setStarting(false);
        }
    }

    if (!dest) return null; // page guards; safety net

    return (
        <div className="flex flex-col h-dvh w-full" style={{ background: 'var(--background)' }}>
            {showHelp && <EnableLocationHelp onClose={() => setShowHelp(false)} />}
            {/* ── Header ── */}
            <div
                className="flex items-center gap-3 px-4 py-3 shrink-0"
                style={{
                    borderBottom: '1px solid var(--card-border)',
                    paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
                }}
            >
                {phase === 'preview' && (
                    <button
                        onClick={onBack}
                        aria-label="Back to orders"
                        className="p-2 -ml-2 rounded-lg cursor-pointer transition-colors hover:bg-overlay/10 text-[var(--foreground)] shrink-0 text-lg leading-none"
                    >
                        ‹
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-[0.875rem] font-semibold truncate text-[var(--foreground)]">
                        {phase === 'active' ? '🚚 Delivering to ' : ''}{customerName}
                    </p>
                    <p className="text-[0.6875rem] text-[var(--text-muted)] line-clamp-3">
                        {order.code}
                        {addressLine ? ` · ${addressLine}` : ''}
                    </p>
                </div>

                {nav && (
                    <div className="text-right shrink-0">
                        <p
                            className="text-[0.9375rem] font-bold tabular-nums leading-tight"
                            style={{ color: arrived ? 'var(--tone-green)' : 'var(--foreground)' }}
                        >
                            {arrived ? 'Arrived' : `${nav.approx ? '≈ ' : ''}${formatDistance(nav.remaining)}`}
                        </p>
                        {!arrived && nav.eta != null && (
                            <p className="text-[0.6875rem] text-[var(--text-muted)]">~{formatEta(nav.eta)}</p>
                        )}
                    </div>
                )}
            </div>

            {/* ── Map ── */}
            <div className="relative flex-1 min-h-0">
                <div ref={mapDivRef} className="absolute inset-0" />

                {!mapReady && !mapError && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-[0.8125rem] text-[var(--text-muted)]">
                        <SpinnerIcon width={16} height={16} /> Loading map…
                    </div>
                )}
                {mapError && (
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                        <p className="text-[0.8125rem] text-red-400 text-center">{mapError}</p>
                    </div>
                )}

                {/* Approximate-location pill — a coarse fix is shown, but flagged */}
                {position && !isPreciseFix(position.accuracy) && (
                    <div
                        className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5"
                        style={{ background: 'rgb(var(--bg-rgb)/0.92)', border: '1px solid var(--card-border)' }}
                    >
                        <span className="text-[0.6875rem] font-semibold text-[var(--foreground)]">
                            Approximate location ({formatAccuracy(position.accuracy)})
                            {!route ? ' — route appears when GPS improves' : ''}
                        </span>
                    </div>
                )}

                {/* GPS status strip — until a LIVE fix exists (preview), while
                    permission is blocked in preview, and whenever the phone's
                    location is off (so "Try again" is reachable mid-ride too) */}
                {mapReady &&
                    (!position ||
                        (phase === 'preview' && (gpsStatus === 'denied' || (gpsStatus === 'granted' && !gpsLive))) ||
                        fixIssue?.kind === 'unavailable') && (
                    <div
                        className="absolute left-3 right-3 bottom-3 rounded-xl p-3 flex items-center gap-2.5"
                        style={{ background: 'rgb(var(--bg-rgb)/0.92)', border: '1px solid var(--card-border)' }}
                    >
                        {gpsStatus === 'prompt' ? (
                            <>
                                <span aria-hidden>📡</span>
                                {/* Prominent disclosure, immediately before the permission request */}
                                <p className="flex-1 text-[0.75rem] leading-relaxed text-[var(--foreground)]">
                                    This app collects your location to show the route, share your live
                                    position with the store during this delivery and record the ride
                                    distance — also with the screen off while the delivery is active.
                                </p>
                                <button
                                    onClick={requestPermission}
                                    className="shrink-0 rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                                >
                                    Agree
                                </button>
                            </>
                        ) : gpsStatus === 'granted' ? (
                            (() => {
                                const m = gpsWaitMessage({ stale: !!position, issue: fixIssue, ...clock });
                                return (
                                    <>
                                        {m.busy ? <SpinnerIcon width={14} height={14} /> : <span aria-hidden>📵</span>}
                                        <p className="flex-1 text-[0.75rem] text-[var(--foreground)]">{m.text}</p>
                                        {fixIssue?.kind === 'unavailable' && (
                                            <button
                                                onClick={retryGps}
                                                className="shrink-0 rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                                            >
                                                Try again
                                            </button>
                                        )}
                                    </>
                                );
                            })()
                        ) : phase === 'preview' && gpsStatus === 'denied' ? (
                            <>
                                <span aria-hidden>🚫</span>
                                <p className="flex-1 text-[0.75rem] text-[var(--foreground)]">
                                    Location is blocked for this app — allow it in settings to start.
                                </p>
                                <button
                                    onClick={() => setShowHelp(true)}
                                    className="shrink-0 rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                                >
                                    How to enable
                                </button>
                            </>
                        ) : (
                            <p className="text-[0.75rem] text-[var(--text-muted)]">
                                {phase === 'preview'
                                    ? 'Location is not available in this browser — the delivery cannot start here.'
                                    : `GPS is unavailable${gpsStatus === 'denied' ? ' (blocked in settings)' : ''} — live tracking is off, but the delivery can continue.`}
                            </p>
                        )}
                    </div>
                )}

                {/* Route errors — Retry refetches immediately */}
                {routeError && position && (
                    <div
                        className="absolute left-3 right-3 bottom-3 rounded-xl p-3 flex items-center gap-2.5"
                        style={{ background: 'rgb(var(--bg-rgb)/0.92)', border: '1px solid rgba(239,68,68,0.35)' }}
                    >
                        <p className="flex-1 text-[0.75rem] text-red-400 truncate">{routeError}</p>
                        <button
                            onClick={() => {
                                setRouteError('');
                                if (position && dest) {
                                    routeOriginAccuracyRef.current = position.accuracy;
                                    fetchRouteNow({ lat: position.lat, lng: position.lng }, dest);
                                }
                            }}
                            disabled={position.accuracy > ROUTE_ORIGIN_MAX_ACCURACY_M}
                            className="shrink-0 rounded-lg px-3 py-1.5 text-[0.75rem] font-semibold cursor-pointer border border-[var(--card-border)] text-[var(--foreground)] hover:bg-overlay/10 disabled:opacity-50"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Recenter — appears when the driver dragged away from the rider */}
                {phase === 'active' && !following && position && (
                    <button
                        onClick={handleRecenter}
                        aria-label="Re-center on my location"
                        className="absolute right-3 bottom-6 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-95"
                        style={{
                            background: 'rgba(15,15,22,0.95)',
                            border: '1px solid var(--card-border)',
                            boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
                        }}
                    >
                        {/* my-location crosshair */}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b8ff5" strokeWidth="2" strokeLinecap="round">
                            <circle cx="12" cy="12" r="7.5" />
                            <circle cx="12" cy="12" r="2.5" fill="#8b8ff5" stroke="none" />
                            <line x1="12" y1="1.5" x2="12" y2="4.5" />
                            <line x1="12" y1="19.5" x2="12" y2="22.5" />
                            <line x1="1.5" y1="12" x2="4.5" y2="12" />
                            <line x1="19.5" y1="12" x2="22.5" y2="12" />
                        </svg>
                    </button>
                )}

                {/* Re-routing badge */}
                {phase === 'active' && nav?.offRoute && (
                    <div
                        className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 flex items-center gap-1.5"
                        style={{ background: 'rgb(var(--bg-rgb)/0.92)', border: '1px solid var(--card-border)' }}
                    >
                        <SpinnerIcon width={12} height={12} />
                        <span className="text-[0.6875rem] font-semibold text-[var(--foreground)]">Re-routing…</span>
                    </div>
                )}
            </div>

            {/* ── Bottom action bar ── */}
            <div
                className="shrink-0 flex flex-col gap-2 px-4 pt-3"
                style={{
                    borderTop: '1px solid var(--card-border)',
                    background: 'rgb(var(--bg-rgb)/0.95)',
                    paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)',
                }}
            >
                {startError && <p className="text-[0.75rem] text-red-400">{startError}</p>}

                {phase === 'preview' ? (
                    <div className="flex gap-3">
                        <button
                            onClick={onBack}
                            disabled={starting}
                            className="flex-1 py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-colors border border-[var(--card-border)] text-[var(--text-muted)] hover:bg-overlay/5 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleStart}
                            disabled={starting || !gpsLive}
                            className="flex-[2] py-3 rounded-xl text-[0.875rem] font-bold cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={OUT_FOR_DELIVERY_BUTTON_STYLE}
                        >
                            {starting ? (
                                <><SpinnerIcon /> Starting…</>
                            ) : (
                                <><TruckIcon width={14} height={14} /> Start</>
                            )}
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={onDeliver}
                        className={`w-full py-3.5 rounded-xl text-[0.9375rem] font-bold cursor-pointer inline-flex items-center justify-center gap-2 ${arrived ? 'animate-pulse' : ''}`}
                        style={DELIVER_BUTTON_STYLE}
                    >
                        <CheckIcon width={14} height={14} /> Delivered
                    </button>
                )}
            </div>
        </div>
    );
}
