'use client';

/**
 * DriverLocationProvider — global GPS tracking for delivery persons.
 *
 * Mounted once in the root layout (inside AuthProvider). Does nothing for
 * admins or logged-out users. For delivery persons it:
 *
 *   1. Detects the geolocation permission state (Permissions API where
 *      available) and exposes it as a simple `status`.
 *   2. Starts a high-accuracy watchPosition once permission is granted.
 *   3. Exposes `position` (every accepted fix — the delivery map modal will
 *      animate from this) and `coarsePosition` (updated only after ~100 m of
 *      movement — the order list derives distances from this so 25 rows
 *      don't re-render on every GPS tick).
 *   4. Caches the last fix in localStorage so distances render instantly on
 *      reload, before the first live fix lands.
 *
 * The permission prompt is NEVER auto-fired in a browser: `requestPermission()`
 * must be called from a user gesture (the LocationGate button). In the Android
 * TWA an unprompted dialog that gets dismissed becomes a hard deny that only
 * system settings can undo — one explanatory tap converts far better.
 * The Capacitor shell is the one exception: its WebView can't report the
 * permission state, so a probe runs on login there (Android runtime
 * permissions need no gesture, and a dismissed system dialog is re-askable).
 *
 * `status` is DERIVED (role + environment + permission state), not stored —
 * effects here only subscribe to external systems (Permissions API, GPS
 * watch) and set state from their callbacks.
 */

import {
    createContext,
    useContext,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { isDeliveryPersonUser } from '@/lib/roles';
import { ACTIVE_DELIVERY_KEY, DRIVER_LAST_FIX_KEY } from '@/lib/constants';
import { haversineMeters, type LatLng } from '@/lib/maps';
import { getSelectedChannelToken } from '@/lib/channel';
import { accumulateOdometer, readOdometerMeters } from '@/lib/odometer';
import { sendDriverHeartbeat } from '@/services/tracking.service';
import {
    checkNativeLocation,
    consumeSettingsVisit,
    isNativeApp,
    startNativeRideWatcher,
    stopNativeRideWatcher,
    type NativeFix,
    type NativeLocationCheck,
} from '@/lib/native-tracking';
import { isRideStreamConnected } from '@/lib/ride-stream-state';
import { BackgroundTrackingConsent } from '@/components/location/BackgroundTrackingConsent';
import { classifyGeoError, isPreciseFix, isUsableFix, type FixIssue } from '@/lib/gps-policy';

// ─── Types ───────────────────────────────────────────────────────────

/**
 * idle        — not a delivery person / not logged in; GPS never touched
 * insecure    — page not served over HTTPS; geolocation unavailable by spec
 * unsupported — browser has no geolocation API
 * prompt      — permission not asked yet; LocationGate shows the enable card
 * granted     — permission OK, watch running (position is null until first fix)
 * denied      — user/OS blocked location; LocationGate shows the recovery banner
 */
export type DriverLocationStatus =
    | 'idle'
    | 'insecure'
    | 'unsupported'
    | 'prompt'
    | 'granted'
    | 'denied';

export interface DriverFix extends LatLng {
    /** Reported accuracy radius in meters */
    accuracy: number;
    /** Degrees clockwise from north; null when stationary/unavailable */
    heading: number | null;
    timestamp: number;
}

interface DriverLocationContextType {
    status: DriverLocationStatus;
    /** Latest accepted GPS fix — updates every tick while watching */
    position: DriverFix | null;
    /** Last fix that moved ≥100 m — subscribe to this for list distances */
    coarsePosition: LatLng | null;
    /** Last transient GPS error (timeouts etc.) — status stays 'granted' */
    lastError: string | null;
    /** Why there is no accepted fix right now (timeout / phone location off /
     *  every fix too rough) — null once a fix is accepted. Lets the delivery
     *  map explain the wait instead of spinning. */
    fixIssue: FixIssue | null;
    /** Fire the native permission prompt. MUST be called from a user gesture. */
    requestPermission: () => void;
    /** Re-arm the GPS watch and clear the last issue — the map strip's "Try again" */
    retryGps: () => void;
    /** Re-arm the watch WITHOUT clearing the issue — for a gate that must keep
     *  blocking until a real fix (or a fresh error) says otherwise */
    recheckGps: () => void;
    /** App shell: a login/interactive Android check (dialog or sheet may be
     *  up) is in progress — buttons show "Checking…" instead of looking dead */
    gpsChecking: boolean;
}

// ─── Tuning constants ────────────────────────────────────────────────

/** Coarse position (→ list distances) only updates after this much movement */
const COARSE_MOVE_THRESHOLD_M = 100;
/* Accuracy grades live in lib/gps-policy — a cell-tower fix 1–3 km wide is
 * accepted as position (it proves location is on and unblocks Start); only
 * PRECISE fixes drive the coarse cache, snapping, arrival and the fleet map. */

/** Cached fixes older than this are ignored — the driver has likely moved */
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Presence ping cadence while IDLE — the backend marks a driver inactive after ~3 missed beats */
const HEARTBEAT_IDLE_MS = 20_000;
/** Faster cadence while a ride is active but the socket stream is down — the
 *  fallback path is then the only thing moving the owner's map, so it hurries */
const HEARTBEAT_RIDE_MS = 5_000;

/** Shown when a requested prompt ended without a decision — see
 *  onPermissionDenied. Cause first, then the two overlay sources seen in the
 *  field; short enough to read on a phone. */
const PROMPT_CLOSED_MSG =
    'The location prompt closed before you chose. If it never appeared, close floating ' +
    'bubbles (chat heads) and any screen recorder, then tap Turn on GPS again.';

/** Hard ceiling on one Android status check (dialog/sheet time included) */
const NATIVE_CHECK_MAX_MS = 30_000;
/** App shell: how often the Location switch is re-read while the rider works */
const NATIVE_SWITCH_POLL_MS = 5_000;

/** One-time consent flag for background (screen-off) ride tracking in the native app */
const BG_CONSENT_KEY = 'bg-tracking-consent';
/** How often the native-watcher effect re-checks whether a ride is active */
const NATIVE_RIDE_CHECK_MS = 3_000;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Last cached fix, or null when absent/stale/corrupt. Client-only. */
function readCachedFix(): LatLng | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DRIVER_LAST_FIX_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw) as { lat?: number; lng?: number; timestamp?: number };
        if (typeof c?.lat !== 'number' || typeof c?.lng !== 'number') return null;
        if (Date.now() - (c.timestamp ?? 0) > CACHE_MAX_AGE_MS) return null;
        return { lat: c.lat, lng: c.lng };
    } catch {
        return null;
    }
}

// ─── Context ─────────────────────────────────────────────────────────

const DriverLocationContext = createContext<DriverLocationContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────

export function DriverLocationProvider({ children }: { children: ReactNode }) {
    const { currentUser, isAuthenticated } = useAuth();
    // GPS is for delivery persons ONLY (same rule as the backend's "Own
    // Delivery Fleet" dropdown — see lib/roles.ts). Admins/SuperAdmin stay
    // at 'idle' forever: no permission query, no watch, no LocationGate
    // banner, no GpsButton chip.
    const enabled = isAuthenticated && isDeliveryPersonUser(currentUser);

    // Environment capability — fixed for the life of the page, checked once.
    // ('ssr' only exists during server render, where isDP is false anyway.)
    const [env] = useState<'ssr' | 'insecure' | 'unsupported' | 'ok'>(() => {
        if (typeof window === 'undefined') return 'ssr';
        if (!window.isSecureContext) return 'insecure';
        if (!('geolocation' in navigator)) return 'unsupported';
        return 'ok';
    });

    // Browser permission state; null = Permissions API query still pending.
    // Old browsers without the Permissions API start at 'prompt' — there the
    // gate button's getCurrentPosition call triggers the native dialog. The
    // Capacitor shell starts at 'prompt' too: its probe (below) may raise the
    // system dialog, and the gate must already stand behind it.
    const [permState, setPermState] = useState<'prompt' | 'granted' | 'denied' | null>(() =>
        typeof navigator !== 'undefined' && (!navigator.permissions?.query || isNativeApp())
            ? 'prompt'
            : null,
    );
    // Mirror for long-lived listeners that must read the latest state
    // (synced in an effect — refs must not be written during render)
    const permStateRef = useRef(permState);
    useEffect(() => {
        permStateRef.current = permState;
    }, [permState]);

    const [position, setPosition] = useState<DriverFix | null>(null);
    // Seeded from cache → list distances render instantly on reload
    const [coarsePosition, setCoarsePosition] = useState<LatLng | null>(readCachedFix);
    const [lastError, setLastError] = useState<string | null>(null);
    const [fixIssue, setFixIssue] = useState<FixIssue | null>(null);
    // Mirror for the watch's visibility listener (synced in an effect)
    const fixIssueRef = useRef<FixIssue | null>(null);
    useEffect(() => {
        fixIssueRef.current = fixIssue;
    }, [fixIssue]);
    // Bumped to tear down and re-create the watch (retryGps / foreground
    // return after "phone location off")
    const [watchEpoch, setWatchEpoch] = useState(0);
    // Ref (not state) so the watch callback compares against the latest value
    // without re-subscribing the watch on every coarse update
    const lastCoarseRef = useRef<LatLng | null>(coarsePosition);
    // Latest accepted fix for the heartbeat sender — a ref so the 20 s
    // interval never re-subscribes on GPS ticks
    const latestFixRef = useRef<DriverFix | null>(null);
    // The heartbeat tick, reachable from processFix: with the screen off,
    // Chromium throttles background timers (eventually to once a minute),
    // so the interval alone lets presence decay mid-ride — every accepted
    // fix also drives a (self-throttled) beat, and fix delivery is exactly
    // what the screen-off foreground service keeps alive
    const heartbeatTickRef = useRef<(() => void) | null>(null);
    // Native (Capacitor) ride watcher — id while running, 'starting' during
    // async startup, null when off. Web fixes are skipped while it streams.
    const nativeWatcherIdRef = useRef<string | null>(null);
    // Prominent-disclosure state for background tracking (native app only)
    const [nativeConsentNeeded, setNativeConsentNeeded] = useState(false);
    const consentDismissedRef = useRef(false);

    // Derived status — no setState needed for the synchronous cases.
    // permState === null (query in flight, resolves in ms) maps to 'idle' so
    // the LocationGate never flashes the wrong card before the state is known.
    const status: DriverLocationStatus = !enabled
        ? 'idle'
        : env === 'insecure'
          ? 'insecure'
          : env !== 'ok'
            ? 'unsupported'
            : (permState ?? 'idle');

    // ── Dev diagnostics — explains gate behaviour for this login ──────
    useEffect(() => {
        if (process.env.NODE_ENV === 'production') return;
        if (!isAuthenticated) return;
        console.info(
            `[gps] status=${status} deliveryPerson=${isDeliveryPersonUser(currentUser)} ` +
            '(rule: role has BOTH TransitionTo* permissions, not SuperAdmin — same as the Own Delivery Fleet dropdown)',
        );
    }, [status, isAuthenticated, currentUser]);

    // ── Subscribe to the Permissions API ──────────────────────────────
    useEffect(() => {
        if (!enabled || env !== 'ok') return;
        if (!navigator.permissions?.query) return; // permState already 'prompt'

        // Android WebView's Permissions API doesn't track geolocation (query
        // answers 'denied' whatever the OS state, onchange never fires) —
        // the app shell is handled by the native status effect below.
        if (isNativeApp()) return;

        let cancelled = false;
        let ps: PermissionStatus | null = null;
        navigator.permissions
            .query({ name: 'geolocation' })
            .then((p) => {
                if (cancelled) return;
                ps = p;
                setPermState(p.state);
                // Tracks changes made in browser/site settings while the app is open
                p.onchange = () => setPermState(p.state);
            })
            .catch(() => {
                if (!cancelled) setPermState('prompt');
            });

        return () => {
            cancelled = true;
            if (ps) ps.onchange = null;
        };
    }, [enabled, env]);

    // ── Fix handling ──────────────────────────────────────────────────
    // processFix is the single pipeline every GPS source feeds — the web
    // watchPosition AND the native background watcher. Odometer, coarse
    // position, heartbeat payload, and the delivery map all read from here,
    // so a fix behaves identically no matter which stack produced it.
    const processFix = useCallback((fix: DriverFix) => {
        if (!isUsableFix(fix.accuracy)) {
            // Multi-km garbage — but SAY so: a silent discard is what left
            // riders staring at "Getting your GPS location…" indoors
            setFixIssue({ kind: 'inaccurate', accuracy: fix.accuracy, at: Date.now(), source: 'web' });
            return;
        }
        setLastError(null);
        setFixIssue(null);
        setPosition(fix);
        latestFixRef.current = fix;
        // Event-driven presence: never rely on background timers mid-ride
        heartbeatTickRef.current?.();

        // Ride odometer: while a delivery is active, fold this fix into the
        // order's cumulative distance (filters live in lib/odometer)
        try {
            const activeOrderId = localStorage.getItem(ACTIVE_DELIVERY_KEY);
            if (activeOrderId) {
                accumulateOdometer(activeOrderId, {
                    lat: fix.lat,
                    lng: fix.lng,
                    accuracy: fix.accuracy,
                    timestamp: fix.timestamp,
                });
            }
        } catch { /* storage blocked — km just stops growing */ }

        // Coarse: good-accuracy fixes only, and only after real movement —
        // this is what keeps the order list from re-rendering every second
        if (isPreciseFix(fix.accuracy)) {
            const last = lastCoarseRef.current;
            if (!last || haversineMeters(last, fix) >= COARSE_MOVE_THRESHOLD_M) {
                const coarse = { lat: fix.lat, lng: fix.lng };
                lastCoarseRef.current = coarse;
                setCoarsePosition(coarse);
                try {
                    localStorage.setItem(
                        DRIVER_LAST_FIX_KEY,
                        JSON.stringify({ ...coarse, timestamp: Date.now() }),
                    );
                } catch {
                    // Storage full/blocked — non-critical
                }
            }
        }
    }, []);

    /** Web geolocation adapter → processFix. Skipped while the native
     *  watcher streams, so the two sources never interleave. */
    const handleFix = useCallback((pos: GeolocationPosition) => {
        if (nativeWatcherIdRef.current) return;
        const { latitude, longitude, accuracy, heading } = pos.coords;
        if (process.env.NODE_ENV !== 'production') {
            // Live-tracking debugging: one line per fix proves whether the
            // browser is delivering position updates at all
            console.info(
                !isUsableFix(accuracy)
                    ? `[gps] fix DISCARDED — accuracy ${Math.round(accuracy)}m is not usable (see lib/gps-policy)`
                    : `[gps] fix ${latitude.toFixed(6)}, ${longitude.toFixed(6)} ±${Math.round(accuracy)}m heading=${heading ?? '—'}`,
            );
        }
        processFix({
            lat: latitude,
            lng: longitude,
            accuracy,
            heading: heading != null && !Number.isNaN(heading) ? heading : null,
            timestamp: pos.timestamp,
        });
    }, [processFix]);

    // ── PERMISSION_DENIED classification ──────────────────────────────
    // Geolocation error code 1 does NOT always mean the user blocked us.
    // Chrome also reports it when the prompt never got a decision: the rider
    // swiped it away, pressed back, or — common on delivery phones — Chrome
    // refused to show it at all because another app was drawing an overlay
    // (a Porter-style bubble, a screen recorder → "This site can't ask for
    // your permission"). The Permissions API tells the cases apart: a real
    // block reads 'denied', a closed prompt still reads 'prompt'. Treating
    // the latter as a block sent riders to phone settings to un-block
    // something that was never blocked, with no way forward.
    //
    // 'granted' + code 1 is the third case: the SITE is allowed but Chrome
    // itself lacks the phone's location permission (Settings → Apps → Chrome
    // → Location). No watch can work then, so it gets the recovery UI too —
    // a silent 'granted' that never produces a fix would be a dead end.
    //
    // `fromPrompt` — true only from requestPermission, where a prompt was
    // actually attempted; the watch path also sees code 1 when a one-time
    // grant lapses or the rider resets the site to Ask, and the overlay
    // advice would be wrong there. Without the Permissions API (older
    // Safari) and inside the native shell (Android's own dialog, no overlay
    // refusal) the old answer stands.
    const onPermissionDenied = useCallback((fromPrompt: boolean) => {
        if (!navigator.permissions?.query || isNativeApp()) {
            setPermState('denied');
            return;
        }
        navigator.permissions
            .query({ name: 'geolocation' })
            .then((p) => {
                if (p.state === 'prompt') {
                    setPermState('prompt');
                    if (fromPrompt) setLastError(PROMPT_CLOSED_MSG);
                } else {
                    setPermState('denied');
                }
            })
            .catch(() => setPermState('denied'));
    }, []);

    // ── App shell: ask Android directly ───────────────────────────────
    // The WebView's geolocation can't distinguish "Location switch off"
    // from "no signal" (some builds just time out), which let riders into
    // the app with GPS off. The official plugin reports the truth: permission
    // state, the Location switch (raising Google's one-tap "turn on
    // location" sheet in interactive modes), and a first fix.
    const applyNativeStatus = useCallback((r: NativeLocationCheck) => {
        // The WebView watch started (or died) while the switch was off may
        // never resume by itself — re-create it ONCE when Android says the
        // switch is back on (never per poll: a fresh watch needs 10–30 s).
        // Only an 'unavailable' that Android itself reported means "switch
        // was off" — a WebView code 2 has other causes, and clearing/re-arming
        // on those every 5 s would loop the watch and flicker the gate
        const nativeOff = fixIssueRef.current?.kind === 'unavailable' && fixIssueRef.current.source === 'native';
        const switchBackOn =
            nativeOff &&
            (r.state === 'granted' ||
                r.state === 'switch-ok' ||
                r.state === 'prompt' ||
                r.state === 'denied' ||
                (r.state === 'no-fix' && r.locationOn));
        if (switchBackOn) setWatchEpoch((n) => n + 1);
        const clearNativeOff = (prev: FixIssue | null) =>
            prev?.kind === 'unavailable' && prev.source === 'native' ? null : prev;
        switch (r.state) {
            case 'granted':
                processFix(r.fix); // clears fixIssue too
                setPermState('granted');
                break;
            case 'switch-ok':
                // Permission held, switch on: only lift a stale "Location off"
                // (the re-armed watch delivers the fixes)
                setPermState('granted');
                setFixIssue(clearNativeOff);
                break;
            case 'prompt':
            case 'denied':
                // These only come back after checkPermissions succeeded —
                // proof the switch is ON, so a stale "Location off" goes
                setPermState(r.state);
                setFixIssue(clearNativeOff);
                break;
            case 'location-off':
                // Only claim 'granted' when the plugin actually saw the
                // permission — otherwise the watch/heartbeat effects would
                // start and the WebView would re-ask right after a "Don't
                // allow". The gate shows "Location off" on the issue alone.
                if (r.perm !== 'unknown') setPermState(r.perm);
                // Same object while it stays off — a new one every 5 s would
                // re-render every consumer of the context
                setFixIssue((prev) =>
                    prev?.kind === 'unavailable' && prev.source === 'native'
                        ? prev
                        : { kind: 'unavailable', at: Date.now(), source: 'native' },
                );
                break;
            case 'no-fix':
                setPermState('granted');
                // A known "Location off" is only downgraded once the switch
                // was confirmed ON (then a coarse fix follows within seconds)
                setFixIssue((prev) =>
                    prev?.kind === 'unavailable' && !r.locationOn ? prev : { kind: 'timeout', at: Date.now(), source: 'native' },
                );
                break;
        }
    }, [processFix]);
    const [gpsChecking, setGpsChecking] = useState(false);
    // Token, not a boolean: a stuck call (activity recreated under an open
    // sheet) must not disable every later check — interactive calls always
    // run; silent polls skip while anything is in flight; and each call
    // gives up after NATIVE_CHECK_MAX_MS
    const nativeCheckSeqRef = useRef(0);
    const nativeCheckInFlightRef = useRef(0);
    const runNativeCheck = useCallback(
        (mode: 'interactive' | 'silent' | 'switch') => {
            const quiet = mode === 'silent' || mode === 'switch';
            if (quiet && nativeCheckInFlightRef.current) return;
            const token = ++nativeCheckSeqRef.current;
            nativeCheckInFlightRef.current = token;
            if (!quiet) setGpsChecking(true);
            // Release the UI after NATIVE_CHECK_MAX_MS even if a dialog is
            // still open; the real answer is still applied when it lands
            const release = () => {
                if (nativeCheckInFlightRef.current === token) nativeCheckInFlightRef.current = 0;
                if (!quiet) setGpsChecking(false);
            };
            const guard = setTimeout(release, NATIVE_CHECK_MAX_MS);
            checkNativeLocation(mode)
                .then(applyNativeStatus)
                .catch((e) => {
                    // Plugin missing (old shell build) or a real failure —
                    // say so instead of leaving a button that does nothing
                    if (process.env.NODE_ENV !== 'production') console.warn('[gps] native check failed', e);
                    setLastError('Could not check location — try again');
                })
                .finally(() => {
                    clearTimeout(guard);
                    release();
                });
        },
        [applyNativeStatus],
    );
    useEffect(() => {
        if (!enabled || env !== 'ok' || !isNativeApp()) return;
        // SILENT on login — Play's Prominent Disclosure rule: the runtime
        // permission dialog may only appear right after the in-app
        // disclosure the rider has agreed to (the gate's "Agree & continue").
        // Silent reports prompt/denied/switch state without any dialog and,
        // when permission is already held, fetches a first fix.
        // (0 ms timer: every setState stays inside an async callback.)
        const t0 = setTimeout(() => runNativeCheck('silent'), 0);
        // Returning from the help sheet's "Open app settings" after a denial:
        // re-check silently (no dialog unless the rider actually allowed it)
        const onVisible = () => {
            if (
                document.visibilityState === 'visible' &&
                permStateRef.current === 'denied' &&
                consumeSettingsVisit()
            ) {
                runNativeCheck('silent');
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        // The rider is inside: keep an eye on the Location switch. A switch
        // flipped off mid-shift must bring the gate back and block Start
        // within seconds — the WebView watch alone may stay silent about it.
        // Permission + switch only (no position request), so it's cheap.
        const poll = setInterval(() => runNativeCheck('switch'), NATIVE_SWITCH_POLL_MS);
        return () => {
            clearTimeout(t0);
            clearInterval(poll);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled, env, runNativeCheck]);

    // ── Watch lifecycle — runs only while status is 'granted' ─────────
    useEffect(() => {
        if (status !== 'granted') return;
        if (process.env.NODE_ENV !== 'production') console.info(`[gps] watch #${watchEpoch} starting`);
        // FAST FIRST FIX: the high-accuracy watch below can take 10–30 s for
        // its first satellite fix (worse indoors — the rider stares at
        // "Getting your GPS location…" with Start disabled even though GPS is
        // on). A parallel one-shot LOW-accuracy request returns a network/
        // cell-based position in ~1–2 s, unblocking the UI immediately; the
        // watch's precise fixes then take over. Cached up to 10 s is fine for
        // this priming role — and still inside the delivery page's 30 s
        // "live" window, so the fix it lands actually enables Start. Errors
        // are ignored — the watch is the real path.
        if (!latestFixRef.current) {
            navigator.geolocation.getCurrentPosition(
                handleFix,
                () => { /* priming only — the watch handles errors */ },
                { enableHighAccuracy: false, maximumAge: 10_000, timeout: 8_000 },
            );
        }
        const id = navigator.geolocation.watchPosition(
            handleFix,
            (err) => {
                if (err.code === err.PERMISSION_DENIED) {
                    onPermissionDenied(false);
                } else {
                    // POSITION_UNAVAILABLE / TIMEOUT — transient; the watch
                    // keeps running and recovers on its own. (Chromium fires
                    // a watch TIMEOUT at most once, so the UI also keeps its
                    // own "waited too long" clock — see DeliveryMapView.)
                    setLastError(err.message || 'Could not get your location');
                    let kind = classifyGeoError(err.code);
                    // App shell: Android's own switch poll decides "Location
                    // off"; a WebView code 2 there (providers still waking up
                    // right after the switch came back, airplane mode) is
                    // just "no fix yet" — otherwise the gate would flicker
                    if (kind === 'unavailable' && isNativeApp()) kind = 'timeout';
                    if (kind) setFixIssue({ kind, at: Date.now(), source: 'web' });
                }
            },
            // maximumAge: 0 — live tracking needs FRESH fixes. Allowing
            // cached positions makes the marker freeze (and Chrome's DevTools
            // location override often emits nothing while caching is allowed).
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
        );
        // Phone location switched off mid-watch reports code 2 and, on some
        // builds, never resumes by itself — re-arm when the app comes back
        // to the foreground after such an error (the rider went to Settings)
        const onVisible = () => {
            if (document.visibilityState === 'visible' && fixIssueRef.current?.kind === 'unavailable') {
                setWatchEpoch((n) => n + 1);
                if (isNativeApp()) runNativeCheck('silent');
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            navigator.geolocation.clearWatch(id);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [status, handleFix, onPermissionDenied, watchEpoch, runNativeCheck]);

    /** Rider-driven retry (the "Try again" buttons). In the app shell this
     *  asks Android again — with the permission dialog / Google's enable-
     *  location sheet if needed — and leaves the issue in place until the
     *  answer lands, so the gate never flashes off. Browser: clear + re-arm. */
    const retryGps = useCallback(() => {
        setLastError(null);
        if (isNativeApp()) {
            runNativeCheck('interactive');
        } else {
            setFixIssue(null);
        }
        setWatchEpoch((n) => n + 1);
    }, [runNativeCheck]);
    // Background re-check, issue left in place, nothing shown to the rider.
    // (App shell: Android is asked directly; the WebView watch is NOT torn
    // down each poll — a high-accuracy watch needs 10–30 s for a first fix.)
    const recheckGps = useCallback(() => {
        if (isNativeApp()) runNativeCheck('silent');
        else setWatchEpoch((n) => n + 1);
    }, [runNativeCheck]);

    // ── Heartbeat — presence pings to the backend every 20 s ──────────
    // Delivery persons only, while GPS is granted (the fleet page derives
    // ACTIVE from these). Carries the latest fix and, during a ride, the
    // cumulative odometer. Fire-and-forget: a missed ping just shows the
    // driver inactive until the next one. A PWA can't ping in background —
    // that silence IS the fleet page's "inactive" signal, by design.
    useEffect(() => {
        if (status !== 'granted' || !isDeliveryPersonUser(currentUser)) return;
        // Dynamic cadence: 20 s while idle, 5 s while a ride is active but the
        // socket stream is down (then this IS the live path). The interval
        // ticks at the fast rate and each tick decides whether it's due.
        let lastSent = 0;
        const tick = () => {
            const now = Date.now();
            const fix = latestFixRef.current;
            // gpsOn = fixes ACTUALLY arriving, not merely permission granted —
            // the device's GPS toggle turning off stops fixes silently, and
            // the fleet page must see that within one beat (the rider shows
            // INACTIVE even mid-ride until GPS comes back).
            const gpsDelivering = !!fix && now - fix.timestamp < 45_000;
            // While the ride socket streams fixes (~2.5 s), the backend stamps
            // presence from them — a heartbeat would be redundant. But a
            // CONNECTED-yet-silent stream (GPS off) carries nothing, so the
            // gpsOn:false announcement must go out via heartbeat regardless.
            // (isRideStreamConnected flips false when the socket dies — e.g.
            // its keepalive timers get throttled with the screen off — and
            // these fix-driven beats then carry presence over plain fetch.)
            // …but the socket only carries PRECISE fixes, so a coarse-only
            // stretch (basement, urban canyon) must still beat over HTTP or
            // the rider decays to Inactive on the fleet page mid-ride
            if (isRideStreamConnected() && gpsDelivering && fix && isPreciseFix(fix.accuracy)) return;
            let activeOrderId: string | null = null;
            try {
                activeOrderId = localStorage.getItem(ACTIVE_DELIVERY_KEY);
            } catch { /* non-critical */ }
            const interval = activeOrderId ? HEARTBEAT_RIDE_MS : HEARTBEAT_IDLE_MS;
            if (now - lastSent < interval) return;
            lastSent = now;
            void sendDriverHeartbeat(
                {
                    gpsOn: gpsDelivering,
                    // A coarse (cell-tower) fix still proves GPS is on, but
                    // its lat/lng would park the rider kilometres away on the
                    // fleet map — send coordinates only when precise
                    ...(fix && isPreciseFix(fix.accuracy) ? { lat: fix.lat, lng: fix.lng } : {}),
                    ...(activeOrderId
                        ? { orderId: activeOrderId, rideDistanceMeters: readOdometerMeters(activeOrderId) }
                        : {}),
                },
                getSelectedChannelToken(currentUser) ?? undefined,
            );
        };
        tick(); // immediate first beat — fleet flips to Active fast
        heartbeatTickRef.current = tick; // fix-driven beats (screen off)
        const id = setInterval(tick, HEARTBEAT_RIDE_MS);
        return () => {
            heartbeatTickRef.current = null;
            clearInterval(id);
        };
    }, [status, currentUser]);

    // ── Native ride watcher (Capacitor app only) ──────────────────────
    // Inside the installed app, an active delivery starts the plugin's
    // foreground service ("Delivery in progress" notification): GPS keeps
    // streaming into processFix with the screen off or the app backgrounded,
    // which also keeps the heartbeat interval and odometer alive — this is
    // the Swiggy/Zomato behavior. The flag is polled because same-tab
    // localStorage writes fire no event. First ride shows the prominent
    // disclosure; consent then lets the watcher request system permissions.
    useEffect(() => {
        if (!enabled || !isNativeApp() || !isDeliveryPersonUser(currentUser)) return;
        let disposed = false;

        const check = async () => {
            if (disposed) return;
            let rideActive = false;
            let consented = false;
            try {
                rideActive = !!localStorage.getItem(ACTIVE_DELIVERY_KEY);
                consented = localStorage.getItem(BG_CONSENT_KEY) === '1';
            } catch { /* storage blocked */ }

            if (rideActive && !consented) {
                if (!consentDismissedRef.current) setNativeConsentNeeded(true);
                return;
            }
            setNativeConsentNeeded(false);

            if (rideActive && consented && nativeWatcherIdRef.current === null) {
                nativeWatcherIdRef.current = 'starting';
                try {
                    const id = await startNativeRideWatcher(
                        (fix: NativeFix) => processFix(fix),
                        () => setLastError('Allow location for this app so rides can be tracked'),
                    );
                    if (disposed) {
                        nativeWatcherIdRef.current = null;
                        void stopNativeRideWatcher(id);
                    } else {
                        nativeWatcherIdRef.current = id;
                    }
                } catch {
                    nativeWatcherIdRef.current = null; // retried on next tick
                }
            } else if (!rideActive && nativeWatcherIdRef.current && nativeWatcherIdRef.current !== 'starting') {
                const id = nativeWatcherIdRef.current;
                nativeWatcherIdRef.current = null;
                void stopNativeRideWatcher(id); // notification disappears
            }
        };

        void check();
        const t = setInterval(check, NATIVE_RIDE_CHECK_MS);
        return () => {
            disposed = true;
            clearInterval(t);
            const id = nativeWatcherIdRef.current;
            nativeWatcherIdRef.current = null;
            if (id && id !== 'starting') void stopNativeRideWatcher(id);
        };
    }, [enabled, currentUser, processFix]);

    const handleConsentAgree = useCallback(() => {
        try {
            localStorage.setItem(BG_CONSENT_KEY, '1');
        } catch { /* non-critical */ }
        setNativeConsentNeeded(false);
        // The watcher starts on the next poll tick and fires the system
        // location prompt (runtime permissions need no user gesture on Android)
    }, []);

    const handleConsentDismiss = useCallback(() => {
        consentDismissedRef.current = true; // don't re-nag this session
        setNativeConsentNeeded(false);
        // Ride continues with foreground-only web tracking, as before
    }, []);

    // ── Explicit permission request (user gesture) ────────────────────
    const requestPermission = useCallback(() => {
        if (!('geolocation' in navigator)) return;
        setLastError(null); // a stale "prompt was closed" note must not sit under a live prompt
        if (isNativeApp()) {
            // System permission dialog and/or Google's enable-location sheet
            runNativeCheck('interactive');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                handleFix(pos);
                // Chromium also flips us via permissions.onchange; this covers
                // Safari where the Permissions API may be missing
                setPermState('granted');
            },
            (err) => {
                if (err.code === err.PERMISSION_DENIED) {
                    onPermissionDenied(true);
                } else {
                    setLastError(err.message || 'Could not get your location');
                    const kind = classifyGeoError(err.code);
                    if (kind) setFixIssue({ kind, at: Date.now(), source: 'web' });
                }
            },
            { enableHighAccuracy: true, timeout: 20_000 },
        );
    }, [handleFix, onPermissionDenied, runNativeCheck]);

    const value = useMemo(
        () => ({ status, position, coarsePosition, lastError, fixIssue, requestPermission, retryGps, recheckGps, gpsChecking }),
        [status, position, coarsePosition, lastError, fixIssue, requestPermission, retryGps, recheckGps, gpsChecking],
    );

    return (
        <DriverLocationContext.Provider value={value}>
            {children}
            {nativeConsentNeeded && (
                <BackgroundTrackingConsent
                    onAgree={handleConsentAgree}
                    onDismiss={handleConsentDismiss}
                />
            )}
        </DriverLocationContext.Provider>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useDriverLocation() {
    const context = useContext(DriverLocationContext);
    if (!context) {
        throw new Error('useDriverLocation must be used within a DriverLocationProvider');
    }
    return context;
}
