/**
 * Native background tracking — the Capacitor half of Swiggy-style rides.
 *
 * When the PWA runs inside the Capacitor shell (the Play Store app), this
 * module exposes the @capacitor-community/background-geolocation watcher: a
 * native foreground service (persistent "Delivery in progress" notification)
 * that keeps GPS flowing with the screen off or the app backgrounded.
 *
 * In a plain browser (or the old TWA) `isNativeApp()` is false and none of
 * this is touched — the web geolocation watch keeps working exactly as before.
 *
 * The watcher is started ONLY while a delivery ride is active and stopped the
 * moment it ends — the notification's presence mirrors tracking, which is
 * both the honest UX and what Play policy expects.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation, type PositionOptions } from '@capacitor/geolocation';

// ─── Plugin surface (community plugin has no bundled TS types) ───────

export interface NativeLocation {
    latitude: number;
    longitude: number;
    /** meters */
    accuracy: number;
    /** degrees clockwise from north, may be null when stationary */
    bearing: number | null;
    /** ms since epoch */
    time: number | null;
    simulated?: boolean;
}

interface WatcherOptions {
    backgroundMessage?: string;
    backgroundTitle?: string;
    requestPermissions?: boolean;
    stale?: boolean;
    distanceFilter?: number;
}

interface BackgroundGeolocationPlugin {
    addWatcher(
        options: WatcherOptions,
        callback: (position?: NativeLocation, error?: { code?: string; message?: string }) => void,
    ): Promise<string>;
    removeWatcher(options: { id: string }): Promise<void>;
    openSettings(): Promise<void>;
}

const BackgroundGeolocation =
    registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

// ─── API ─────────────────────────────────────────────────────────────

/** True only inside the Capacitor shell (the installed app), never in a browser. */
export function isNativeApp(): boolean {
    return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export interface NativeFix {
    lat: number;
    lng: number;
    accuracy: number;
    heading: number | null;
    timestamp: number;
}

/**
 * Start the ride watcher (foreground service + notification). Returns the
 * watcher id. `requestPermissions: true` fires the system location prompt if
 * not yet granted — call from a user-gesture flow the first time.
 */
export async function startNativeRideWatcher(
    onFix: (fix: NativeFix) => void,
    onPermissionDenied: () => void,
): Promise<string> {
    return BackgroundGeolocation.addWatcher(
        {
            backgroundTitle: 'Delivery in progress',
            backgroundMessage: 'Kaaikani is tracking your ride location',
            requestPermissions: true,
            // never deliver cached/stale fixes — same rule as the web watch
            stale: false,
            // meters between callbacks; small enough for a smooth map,
            // large enough to skip standstill jitter
            // 0 = every fix, not just movement: a rider waiting at a gate with
            // the screen off must keep producing fixes, or the fleet page
            // decays to Inactive (the odometer ignores <10 m jitter anyway)
            distanceFilter: 0,
        },
        (position, error) => {
            if (error) {
                if (error.code === 'NOT_AUTHORIZED') onPermissionDenied();
                return;
            }
            if (!position) return;
            onFix({
                lat: position.latitude,
                lng: position.longitude,
                accuracy: position.accuracy,
                heading:
                    position.bearing != null && !Number.isNaN(position.bearing)
                        ? position.bearing
                        : null,
                timestamp: position.time ?? Date.now(),
            });
        },
    );
}

export async function stopNativeRideWatcher(id: string): Promise<void> {
    try {
        await BackgroundGeolocation.removeWatcher({ id });
    } catch {
        // already stopped — fine
    }
}

let settingsVisitPending = false;

/** Open the app's system settings — recovery path when location was denied. */
export function openNativeAppSettings(): void {
    settingsVisitPending = true;
    void BackgroundGeolocation.openSettings().catch(() => {});
}

// ─── Direct Android status check (official Geolocation plugin) ───────
//
// The WebView's navigator.geolocation can't tell "Location switch is off"
// from "no signal yet" — on some builds it just times out — so the gate
// used to let riders in with GPS off. Android itself knows: the official
// plugin reports permission state, a disabled Location switch (and can
// raise Google's one-tap "turn on location" sheet), and hands back a fix.

export type NativeLocationCheck =
    | { state: 'prompt' | 'denied' }
    /** 'switch' mode only: permission held and the Location switch is on */
    | { state: 'switch-ok' }
    /** Location switch off; `perm` = what we know about the runtime permission */
    | { state: 'location-off'; perm: 'granted' | 'prompt' | 'denied' | 'unknown' }
    /** Permission fine, no fix in time; `locationOn` = the switch was confirmed on */
    | { state: 'no-fix'; locationOn: boolean }
    | { state: 'granted'; fix: NativeFix };

/**
 * `interactive`: one call to getCurrentPosition — the plugin asks for the
 * permission itself (system dialog) and, with enableLocationFallback, raises
 * Google's one-tap "turn on location" sheet when the switch is off. ONLY
 * call this right after an in-app disclosure the rider agreed to (Play's
 * Prominent Disclosure & Consent rule).
 * `silent`/`switch`: report only, never show anything (login, polling).
 *
 * Plugin quirk that shaped this: checkPermissions()/requestPermissions()
 * themselves REJECT with OS-PLUG-GLOC-0007 while the Location switch is off,
 * so every call sits inside the try and 0007 anywhere means "location off".
 */
export async function checkNativeLocation(
    mode: 'interactive' | 'silent' | 'switch',
): Promise<NativeLocationCheck> {
    type Perm = { location: string; coarseLocation: string };
    // "Approximate" (coarse only) is a grant — the plugin itself accepts it
    const mapPerm = (p: Perm): 'prompt' | 'denied' | 'granted' =>
        p.location === 'granted' || p.coarseLocation === 'granted'
            ? 'granted'
            : p.location === 'denied' && p.coarseLocation === 'denied'
              ? 'denied'
              : 'prompt';
    // OS-PLUG-GLOC-0007 services disabled · 0009 enable sheet declined ·
    // 0016/0017 location-settings failures · 0003 permission denied ·
    // 0010 timeout · 0002 unavailable
    const errText = (e: unknown) => {
        const err = e as { code?: unknown; message?: unknown };
        return `${String(err?.code ?? '')} ${String(err?.message ?? '')}`;
    };
    const isLocationOff = (e: unknown) =>
        /GLOC-0007|GLOC-0009|GLOC-0016|GLOC-0017|not enabled|enable location|location settings/i.test(errText(e));
    const isPermDenied = (e: unknown) => /GLOC-0003|permission/i.test(errText(e));
    try {
        if (mode === 'silent' || mode === 'switch') {
            // Permission + switch only — never a position request, so the
            // answer is instant: the rider isn't held on the gate while a
            // first fix is found (the watch does that after entry). Rejects
            // with 0007 while the switch is off — nothing below runs then.
            const perm = mapPerm(await Geolocation.checkPermissions());
            return perm === 'granted' ? { state: 'switch-ok' } : { state: perm };
        }
        // interactive: ask for the permission by itself first. Granted →
        // done immediately (no waiting for a fix — entering the app must
        // not take 15 s indoors). Rejects with 0007 when the switch is off;
        // then fall through to getCurrentPosition, whose fallback raises
        // Google's enable-location sheet (and asks permission if needed).
        try {
            const perm = mapPerm(await Geolocation.requestPermissions({ permissions: ['location'] }));
            return perm === 'granted' ? { state: 'switch-ok' } : { state: perm };
        } catch (e) {
            if (!isLocationOff(e)) throw e;
        }
        const opts = {
            // High accuracy so the plugin requests the fine+coarse alias: ONE
            // system dialog (with Precise/Approximate) instead of a coarse-
            // only one followed by the WebView re-asking for fine.
            enableHighAccuracy: true,
            maximumAge: 60_000,
            // Short: after the sheet is accepted a fix may still take a
            // while indoors — 'no-fix' with the switch on lets the rider in
            // and the watch picks up from there
            timeout: 8_000,
            // Android-only option, not in the TS type. Counter-intuitive but
            // verified in the native lib: `false` turns the resolution UI ON
            // (sheet on any resolvable settings issue), `true` lets it fall
            // back to LocationManager quietly. Always true — the enable-
            // location sheet still appears in the asking modes because the
            // plugin raises it for a disabled switch regardless, while the
            // silent poll can never show it (checkPermissions rejects first).
            enableLocationFallback: true,
        };
        const pos = await Geolocation.getCurrentPosition(opts as PositionOptions);
        return {
            state: 'granted',
            fix: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                heading: pos.coords.heading ?? null,
                timestamp: pos.timestamp,
            },
        };
    } catch (e) {
        if (isLocationOff(e)) {
            // In interactive mode the permission dialog comes BEFORE the
            // switch check, so reaching a switch error means it was granted
            return { state: 'location-off', perm: mode === 'interactive' ? 'granted' : 'unknown' };
        }
        if (isPermDenied(e) && mode === 'interactive') {
            // "Don't allow" once is still askable on Android 11+; let the OS
            // say whether this is a hard block or just "ask again"
            try {
                const perm = mapPerm(await Geolocation.checkPermissions());
                return perm === 'granted' ? { state: 'no-fix', locationOn: false } : { state: perm };
            } catch (e2) {
                return isLocationOff(e2) ? { state: 'location-off', perm: 'prompt' } : { state: 'denied' };
            }
        }
        if (isPermDenied(e)) return { state: 'denied' };
        // Timeout / unavailable. Usually the switch is on (the silent path got
        // past checkPermissions, the asking paths past the settings check) —
        // but a phone WITHOUT Play Services skips that check and just times
        // out with the switch off, and the switch may have been flipped
        // during the wait. One dialog-less native call settles it:
        // checkPermissions rejects with 0007 whenever the switch is off.
        try {
            await Geolocation.checkPermissions();
            return { state: 'no-fix', locationOn: true };
        } catch (e2) {
            return isLocationOff(e2)
                ? { state: 'location-off', perm: 'granted' } // permission was needed to get this far
                : { state: 'no-fix', locationOn: false };
        }
    }
}

/** Open the phone's LOCATION settings (the master switch), not the app's
 *  page. Capacitor can't launch an Android settings intent from a URL, so
 *  this goes through the capacitor-native-settings plugin; without it
 *  (older shell build) the button falls back to the app-settings page. */
export function openNativeLocationSettings(): void {
    // (No settings-visit flag here: that flag is for the permission probe
    // while 'denied'; the watch re-arms itself on return via visibilitychange
    // while the issue is "location off".)
    void import('capacitor-native-settings')
        .then(({ NativeSettings, AndroidSettings }) =>
            NativeSettings.openAndroid({ option: AndroidSettings.Location }),
        )
        .catch(() => BackgroundGeolocation.openSettings().catch(() => {}));
}

/** True exactly once after openNativeAppSettings(). The provider re-checks
 *  the permission on the next foreground ONLY then — re-checking on every
 *  ordinary app switch would raise the system dialog uninvited while a
 *  denial is still askable. */
export function consumeSettingsVisit(): boolean {
    const pending = settingsVisitPending;
    settingsVisitPending = false;
    return pending;
}
