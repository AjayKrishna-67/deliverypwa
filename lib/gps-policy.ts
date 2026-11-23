/**
 * GPS accuracy policy — the one place that decides what a fix is good for.
 *
 * Android hands the browser whatever the fused provider has. Indoors at a
 * pickup point that is often a cell-tower fix 1–3 km wide; a Wi-Fi fix is
 * 20–100 m; a satellite lock 5–30 m. The app used to throw away everything
 * worse than 1 km, silently — so a rider standing inside the store saw
 * "Getting your GPS location…" forever, with Start disabled, even though
 * location was on and permitted (Chromium never re-reports a timeout, so no
 * error surfaced either).
 *
 * The policy now is graded instead of binary:
 *   · USABLE  (≤ MAX_USABLE_ACCURACY_M)  — proves location services are on;
 *     unblocks Start and shows the rider roughly where they are.
 *   · PRECISE (≤ PRECISE_ACCURACY_M)     — good enough to snap to the route,
 *     detect arrival, feed the fleet map and the coarse cache.
 * Everything else is discarded, but that discard is REPORTED (fixIssue), so
 * the UI can say "location too rough" instead of spinning.
 */

/** Worse than this is garbage even as a "location is on" signal */
export const MAX_USABLE_ACCURACY_M = 5000;
/** At or below this a fix may drive route snapping, arrival, fleet position */
export const PRECISE_ACCURACY_M = 200;
/** Arrival ("Delivered" pulse) needs a tighter fix than ordinary tracking */
export const ARRIVAL_MAX_ACCURACY_M = 100;
/** A route drawn from a start point rougher than this is more wrong than useful */
export const ROUTE_ORIGIN_MAX_ACCURACY_M = 1000;
/** With no fix after this long the strip stops saying "getting…" and gives advice */
export const GPS_SLOW_AFTER_MS = 20_000;

export function isUsableFix(accuracyMeters: number): boolean {
    return accuracyMeters <= MAX_USABLE_ACCURACY_M;
}

export function isPreciseFix(accuracyMeters: number): boolean {
    return accuracyMeters <= PRECISE_ACCURACY_M;
}

/** Why the provider has no accepted fix right now */
export interface FixIssue {
    kind: 'timeout' | 'unavailable' | 'inaccurate';
    /** For 'inaccurate': the accuracy of the last discarded fix */
    accuracy?: number;
    at: number;
    /** Who reported it — 'native' = Android itself (app shell), else the WebView */
    source?: 'native' | 'web';
}

/** Geolocation error code → issue kind (code 1 is a permission matter, not an issue) */
export function classifyGeoError(code: number): FixIssue['kind'] | null {
    if (code === 2) return 'unavailable';
    if (code === 3) return 'timeout';
    return null;
}

export function formatAccuracy(meters: number): string {
    return meters >= 1000 ? `±${(meters / 1000).toFixed(1)} km` : `±${Math.round(meters)} m`;
}

export interface GpsWaitState {
    /** A fix exists but is too old to count as live */
    stale: boolean;
    issue: FixIssue | null;
    /** How long the map has been waiting for a live fix */
    waitedMs: number;
    /** Clock for judging issue age (pass the same tick that drives waitedMs) */
    now: number;
}

/** Text for the map's GPS strip while there is no LIVE fix. `busy` = show a spinner. */
export function gpsWaitMessage(s: GpsWaitState): { text: string; busy: boolean } {
    // An 'inaccurate' report only describes the moment it was made — if
    // fixes then stop altogether, the radius it quotes is no longer the story
    const issue =
        s.issue?.kind === 'inaccurate' && s.now - s.issue.at >= GPS_SLOW_AFTER_MS ? null : s.issue;
    if (issue?.kind === 'unavailable') {
        return { text: 'Phone location is off — swipe down and turn on Location.', busy: false };
    }
    if (issue?.kind === 'inaccurate') {
        return {
            text: `Location too rough (${formatAccuracy(issue.accuracy ?? 0)}) — move to open sky for a better fix.`,
            busy: true,
        };
    }
    if (s.stale) {
        return { text: 'GPS signal lost — waiting for a fresh fix…', busy: true };
    }
    if (issue?.kind === 'timeout' || s.waitedMs >= GPS_SLOW_AFTER_MS) {
        return {
            text: 'No GPS signal yet — step outside or near a window, and check Location is on.',
            busy: true,
        };
    }
    return { text: 'Getting your GPS location…', busy: true };
}
