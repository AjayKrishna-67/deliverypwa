/**
 * Money lives as integer minor units (paise) on the wire and in Vendure.
 * Rupees are a display-only concept. Convert at the UI boundary only.
 */

/** Paise -> rupee string for display, e.g. 4050 -> "40.50". */
export function paiseToRupeeString(paise: number | null): string {
    if (paise === null || paise === undefined) return '';
    return (paise / 100).toFixed(2);
}

export interface ParsedPrice {
    ok: boolean;
    paise: number;
    error?: string;
}

/**
 * Parse a rupee input string into paise, with the client-side validation the
 * design review required (numeric, non-negative, non-empty) so the atomic
 * server save almost never rejects a batch.
 */
export function parseRupeeInput(raw: string): ParsedPrice {
    const trimmed = (raw ?? '').trim();
    if (trimmed === '') {
        return { ok: false, paise: 0, error: 'empty' };
    }
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
        return { ok: false, paise: 0, error: 'not a valid amount' };
    }
    const rupees = Number(trimmed);
    if (!Number.isFinite(rupees) || rupees < 0) {
        return { ok: false, paise: 0, error: 'must be 0 or more' };
    }
    return { ok: true, paise: Math.round(rupees * 100) };
}

/** Stable key for a (variant, channel) cell. */
export function cellKey(variantId: string, channelId: string): string {
    return `${variantId}:${channelId}`;
}
