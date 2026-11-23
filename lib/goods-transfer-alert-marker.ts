/**
 * The id of the newest alert this device has already shown.
 *
 * Kept per USER and per BRANCH. Per branch because the streams are separate — what
 * Idukki has seen says nothing about what Madurai has seen, and one marker shared
 * between them would silently swallow the other branch's alerts. Per user because
 * this dashboard is signed into on shared devices: without the id in the key, the
 * next person to sign in would inherit the previous person's marker and never be
 * told about anything that happened before they arrived.
 *
 * It must survive a refresh. Held only in memory, a reload would forget it, the
 * request would fall back to "the last few minutes", and every refresh would replay
 * the same alerts.
 *
 * This lives on its own because TWO readers advance it: the background poll, and
 * the transfer list — whose ordinary read already carries the alerts, so it should
 * not make a second request for them. One marker, one meaning, one place.
 */

/**
 * How often alerts are asked for — by the background poll, and by the transfer
 * list, which asks for them along with its rows.
 *
 * Shared so the two cannot drift. Often enough to feel prompt, rare enough to be
 * nothing on a server.
 */
export const ALERT_INTERVAL_MS = 20_000;

const MARKER_PREFIX = 'gt.lastAlert.';

function markerKey(userId: string, channelToken: string): string {
    return `${MARKER_PREFIX}${userId}.${channelToken}`;
}

export function readAlertMarker(userId: string, channelToken: string): string | null {
    try {
        return localStorage.getItem(markerKey(userId, channelToken));
    } catch {
        // Storage can be unavailable (private mode, blocked cookies). Losing the
        // marker means seeing a few alerts twice, which is better than crashing.
        return null;
    }
}

export function writeAlertMarker(userId: string, channelToken: string, id: string): void {
    try {
        localStorage.setItem(markerKey(userId, channelToken), id);
    } catch {
        // As above — nothing useful to do, and nothing worth interrupting for.
    }
}

/**
 * When alerts were last asked for, by anyone.
 *
 * The poll stands down on the list, whose own read carries the alerts. Walking off
 * the list starts it again — and without this, "starting again" meant asking
 * immediately, so every step away from the list cost a request for something read a
 * moment earlier. Knowing when the last read happened lets the poll wait out the
 * remainder of its interval instead.
 *
 * In memory rather than storage: it describes this tab's traffic, and a stale value
 * from a previous session would only delay the first poll by up to twenty seconds.
 */
let lastFetchedAt = 0;

export function markAlertsFetched(): void {
    lastFetchedAt = Date.now();
}

export function msSinceAlertsFetched(): number {
    return Date.now() - lastFetchedAt;
}
