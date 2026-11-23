/**
 * Expiry Days report — every product variant with its shelf life
 * (ProductVariant.customFields.expiryDays, filled by the Admin Team), coloured
 * by day counts the person enters:
 *
 *   red    — 0 … red days
 *   yellow — red + 1 … yellow days
 *   green  — yellow + 1 … green days
 *
 * Longer shelf lives, and variants with no expiry days yet, sit outside the
 * three colours so they can still be found.
 */

export interface VariantExpiry {
    id: string;
    name: string;
    sku: string;
    enabled: boolean;
    /** Shelf life in days; null when the Admin Team has not filled it in. */
    expiryDays: number | null;
}

export type ExpiryColor = 'red' | 'yellow' | 'green';
export type ExpiryBand = ExpiryColor | 'longer' | 'unset';

/** Upper day count of each colour. */
export type ExpiryThresholds = Record<ExpiryColor, number>;

export const EXPIRY_COLORS: ExpiryColor[] = ['red', 'yellow', 'green'];
export const EXPIRY_BANDS: ExpiryBand[] = ['red', 'yellow', 'green', 'longer', 'unset'];

export const DEFAULT_EXPIRY_THRESHOLDS: ExpiryThresholds = { red: 3, yellow: 7, green: 30 };

/** First colour whose count the days fit under. */
export function expiryBand(days: number | null, t: ExpiryThresholds): ExpiryBand {
    if (days == null) return 'unset';
    if (days <= t.red) return 'red';
    if (days <= t.yellow) return 'yellow';
    if (days <= t.green) return 'green';
    return 'longer';
}

/** Each count should be more than the one before it, or the later colour gets no days. */
export function thresholdsInOrder(t: ExpiryThresholds): boolean {
    return t.red < t.yellow && t.yellow < t.green;
}

function dayRange(from: number, to: number): string {
    if (from > to) return '—';
    if (from === to) return `${to} day${to === 1 ? '' : 's'}`;
    return `${from}–${to} day${to === 1 ? '' : 's'}`;
}

/** "0–3 days", "4–7 days", "Over 30 days" … */
export function bandRangeLabel(band: ExpiryBand, t: ExpiryThresholds): string {
    switch (band) {
        case 'red':
            return dayRange(0, t.red);
        case 'yellow':
            return dayRange(t.red + 1, t.yellow);
        case 'green':
            return dayRange(Math.max(t.red, t.yellow) + 1, t.green);
        case 'longer':
            return `Over ${Math.max(t.red, t.yellow, t.green)} days`;
        case 'unset':
            return 'No expiry days';
    }
}

export function bandCounts(rows: VariantExpiry[], t: ExpiryThresholds): Record<ExpiryBand, number> {
    const counts: Record<ExpiryBand, number> = { red: 0, yellow: 0, green: 0, longer: 0, unset: 0 };
    for (const r of rows) counts[expiryBand(r.expiryDays, t)] += 1;
    return counts;
}

/** Counts saved on this device; anything missing or broken falls back to the default. */
export function parseStoredThresholds(raw: string | null): ExpiryThresholds {
    let saved: Record<string, unknown> = {};
    try {
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
    } catch {
        // fall through to the defaults
    }
    const pick = (c: ExpiryColor) => {
        const n = saved[c];
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : DEFAULT_EXPIRY_THRESHOLDS[c];
    };
    return { red: pick('red'), yellow: pick('yellow'), green: pick('green') };
}

/** Name and SKU match anywhere; the id matches exactly, so "14" does not pull in 148. */
export function matchesVariantSearch(row: VariantExpiry, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.id === q || row.name.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q);
}

/** Fewest expiry days first; variants without any last. */
export function sortByExpiryDays(rows: VariantExpiry[]): VariantExpiry[] {
    return [...rows].sort((a, b) => {
        if (a.expiryDays == null || b.expiryDays == null) {
            if (a.expiryDays != null) return -1;
            if (b.expiryDays != null) return 1;
        } else if (a.expiryDays !== b.expiryDays) {
            return a.expiryDays - b.expiryDays;
        }
        return a.name.localeCompare(b.name);
    });
}
