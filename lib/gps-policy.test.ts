import { describe, expect, test } from 'bun:test';
import {
    classifyGeoError,
    formatAccuracy,
    gpsWaitMessage,
    isPreciseFix,
    isUsableFix,
    GPS_SLOW_AFTER_MS,
    MAX_USABLE_ACCURACY_M,
    PRECISE_ACCURACY_M,
} from './gps-policy';

describe('accuracy grades', () => {
    test('an indoor cell-tower fix (1–3 km) is USABLE but not precise', () => {
        // The field bug: the provider used to discard anything worse than
        // 1 km, leaving the delivery page on "Getting your GPS location…"
        // with Start disabled. Usable now means "location is on".
        expect(isUsableFix(1500)).toBe(true);
        expect(isUsableFix(3000)).toBe(true);
        expect(isPreciseFix(1500)).toBe(false);
    });
    test('a Wi-Fi or satellite fix is precise', () => {
        expect(isPreciseFix(25)).toBe(true);
        expect(isPreciseFix(PRECISE_ACCURACY_M)).toBe(true);
        expect(isPreciseFix(PRECISE_ACCURACY_M + 1)).toBe(false);
    });
    test('usable boundary is inclusive; multi-km garbage is still discarded', () => {
        expect(isUsableFix(MAX_USABLE_ACCURACY_M)).toBe(true);
        expect(isUsableFix(MAX_USABLE_ACCURACY_M + 1)).toBe(false);
    });
});

describe('error classification', () => {
    test('maps Geolocation codes', () => {
        expect(classifyGeoError(2)).toBe('unavailable');
        expect(classifyGeoError(3)).toBe('timeout');
        expect(classifyGeoError(1)).toBeNull(); // permission — handled elsewhere
        expect(classifyGeoError(0)).toBeNull();
        expect(classifyGeoError(99)).toBeNull();
    });
});

describe('strip message', () => {
    const now = 100_000;
    const base = { stale: false, issue: null, waitedMs: 0, now };
    test('first seconds: plain waiting', () => {
        expect(gpsWaitMessage({ ...base, waitedMs: 3_000 })).toEqual({
            text: 'Getting your GPS location…',
            busy: true,
        });
    });
    test('after the slow threshold it gives advice even with no error (Chromium never re-reports timeouts)', () => {
        const m = gpsWaitMessage({ ...base, waitedMs: GPS_SLOW_AFTER_MS });
        expect(m.text).toContain('No GPS signal yet');
    });
    test('timeout error gives the same advice immediately', () => {
        const m = gpsWaitMessage({ ...base, issue: { kind: 'timeout', at: now } });
        expect(m.text).toContain('No GPS signal yet');
    });
    test('unavailable → tell them the phone toggle is off, no spinner', () => {
        const m = gpsWaitMessage({ ...base, issue: { kind: 'unavailable', at: now } });
        expect(m).toEqual({ text: 'Phone location is off — swipe down and turn on Location.', busy: false });
    });
    test('inaccurate → shows the radius', () => {
        const m = gpsWaitMessage({ ...base, issue: { kind: 'inaccurate', accuracy: 7200, at: now } });
        expect(m.text).toContain('±7.2 km');
    });
    test('stale fix → signal lost', () => {
        const m = gpsWaitMessage({ ...base, stale: true, waitedMs: 60_000 });
        expect(m.text).toContain('GPS signal lost');
    });
    test('precedence: unavailable > inaccurate > stale > timeout', () => {
        expect(gpsWaitMessage({ ...base, stale: true, issue: { kind: 'unavailable', at: now } }).text)
            .toContain('Phone location is off');
        // walked back indoors after a good fix: the rough radius is the useful advice
        expect(gpsWaitMessage({ ...base, stale: true, issue: { kind: 'inaccurate', accuracy: 2100, at: now } }).text)
            .toContain('too rough');
        // a stale fix plus a timeout: "signal lost" is what happened
        expect(gpsWaitMessage({ ...base, stale: true, issue: { kind: 'timeout', at: now } }).text)
            .toContain('GPS signal lost');
    });
    test('an old inaccurate report expires — if fixes stopped, say so instead of quoting a stale radius', () => {
        const old = { kind: 'inaccurate' as const, accuracy: 8000, at: now - GPS_SLOW_AFTER_MS };
        expect(gpsWaitMessage({ ...base, stale: true, issue: old, waitedMs: 60_000 }).text)
            .toContain('GPS signal lost');
        expect(gpsWaitMessage({ ...base, issue: old, waitedMs: 60_000 }).text)
            .toContain('No GPS signal yet');
    });
});

describe('formatAccuracy', () => {
    test('meters below 1 km, km from 1 km', () => {
        expect(formatAccuracy(35.4)).toBe('±35 m');
        expect(formatAccuracy(999)).toBe('±999 m');
        expect(formatAccuracy(1000)).toBe('±1.0 km');
        expect(formatAccuracy(1850)).toBe('±1.9 km');
    });
});
