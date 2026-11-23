import { describe, expect, test } from 'bun:test';
import {
    bandCounts,
    bandRangeLabel,
    DEFAULT_EXPIRY_THRESHOLDS,
    expiryBand,
    matchesVariantSearch,
    parseStoredThresholds,
    sortByExpiryDays,
    thresholdsInOrder,
    type VariantExpiry,
} from './expiry-days';

const t = DEFAULT_EXPIRY_THRESHOLDS; // red ≤ 3, yellow ≤ 7, green ≤ 30

function v(id: string, name: string, sku: string, expiryDays: number | null): VariantExpiry {
    return { id, name, sku, enabled: true, expiryDays };
}

describe('colour bands from the day counts entered', () => {
    test('each colour covers up to its count, after the colour before it', () => {
        expect(expiryBand(0, t)).toBe('red');
        expect(expiryBand(3, t)).toBe('red');
        expect(expiryBand(4, t)).toBe('yellow');
        expect(expiryBand(7, t)).toBe('yellow');
        expect(expiryBand(8, t)).toBe('green');
        expect(expiryBand(30, t)).toBe('green');
    });
    test('beyond the green count, and variants with no expiry days, sit outside the colours', () => {
        expect(expiryBand(31, t)).toBe('longer');
        expect(expiryBand(null, t)).toBe('unset');
    });
    test('range labels follow the counts', () => {
        expect(bandRangeLabel('red', t)).toBe('0–3 days');
        expect(bandRangeLabel('yellow', t)).toBe('4–7 days');
        expect(bandRangeLabel('green', t)).toBe('8–30 days');
        expect(bandRangeLabel('longer', t)).toBe('Over 30 days');
        expect(bandRangeLabel('unset', t)).toBe('No expiry days');
        expect(bandRangeLabel('red', { red: 1, yellow: 2, green: 3 })).toBe('0–1 day');
        expect(bandRangeLabel('yellow', { red: 1, yellow: 2, green: 3 })).toBe('2 days');
    });
    test('counts that do not go up leave the later colour empty', () => {
        const bad = { red: 7, yellow: 3, green: 30 };
        expect(thresholdsInOrder(bad)).toBe(false);
        expect(thresholdsInOrder(t)).toBe(true);
        expect(expiryBand(5, bad)).toBe('red');
        expect(bandRangeLabel('yellow', bad)).toBe('—');
    });
    test('counts per band', () => {
        const rows = [v('1', 'a', '', 2), v('2', 'b', '', 3), v('3', 'c', '', 10), v('4', 'd', '', 90), v('5', 'e', '', null)];
        expect(bandCounts(rows, t)).toEqual({ red: 2, yellow: 0, green: 1, longer: 1, unset: 1 });
    });
});

describe('saved counts', () => {
    test('reads what was saved', () => {
        expect(parseStoredThresholds('{"red":2,"yellow":5,"green":15}')).toEqual({ red: 2, yellow: 5, green: 15 });
    });
    test('anything missing or broken falls back to the defaults', () => {
        expect(parseStoredThresholds(null)).toEqual(t);
        expect(parseStoredThresholds('not json')).toEqual(t);
        expect(parseStoredThresholds('{"red":-1,"yellow":"x","green":12}')).toEqual({ red: 3, yellow: 7, green: 12 });
    });
});

describe('search by product variant name, id or SKU', () => {
    const row = v('148', 'Ellu Laddoo 10 Pieces', 'SM-ELLU-10', 15);
    test('name and SKU match anywhere, any case', () => {
        expect(matchesVariantSearch(row, 'laddoo')).toBe(true);
        expect(matchesVariantSearch(row, 'sm-ellu')).toBe(true);
        expect(matchesVariantSearch(row, 'ribbon')).toBe(false);
    });
    test('the id matches exactly, so "14" does not pull in 148', () => {
        expect(matchesVariantSearch(row, '148')).toBe(true);
        expect(matchesVariantSearch(row, '14')).toBe(false);
    });
    test('blank search shows everything', () => {
        expect(matchesVariantSearch(row, '  ')).toBe(true);
    });
});

describe('order on the page', () => {
    test('fewest expiry days first, then by name; variants without any last', () => {
        const rows = [v('1', 'Mysore Pak', '', 10), v('2', 'Badam Halwa', '', null), v('3', 'Jangiri', '', 2), v('4', 'Kaju Katli', '', 10)];
        expect(sortByExpiryDays(rows).map((r) => r.id)).toEqual(['3', '4', '1', '2']);
    });
});
