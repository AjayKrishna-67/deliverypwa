/**
 * Purchase List report service. Backend gates on `ViewBusinessReports` or
 * `ViewDailyInvoiceReport`. Rows arrive already aggregated and sorted
 * (ordNo, then Tamil collation) — the UI only renders them.
 */

import { vendureFetch } from '@/graphql/client';
import { PURCHASE_LIST_REPORT_QUERY } from '@/graphql/operations/purchase-list';

// ─── Types ───────────────────────────────────────────────────────────

/** How a quantity is expressed. Decides the maths, not just the label. */
export type PurchaseUnitKind = 'WEIGHT' | 'VOLUME' | 'COUNT';

/** Whether a row speaks for a whole product or for one variant of it. */
export type PurchaseRowScope = 'PRODUCT' | 'VARIANT';

export interface PurchaseListRow {
    /** Section from FacetValue.purchaseOrdNo (lowest of the product's tags).
     *  Null when the product carries no tagged facet value — sorts last. */
    ordNo: number | null;
    /** Tamil first, English only as a rescue. PRODUCT rows use
     *  Product.localName ?? Product.name; VARIANT rows use
     *  ProductVariant.localName ?? ProductVariant.name. */
    label: string;
    productId: string;
    /** Set on a VARIANT row, null on a PRODUCT row. */
    variantId: string | null;
    scope: PurchaseRowScope;
    /** Kilograms for WEIGHT, litres for VOLUME, whole units for COUNT. */
    totalQty: number;
    unitKind: PurchaseUnitKind;
    /** What to print beside the number: kg / l / Pcs. */
    unitLabel: string;
    /** Distinct variants summed into this row. Always 1 on a VARIANT row. */
    variantCount: number;
    /** True when any line in this row had no usable measurement: part of
     *  totalQty is then an ordered count (or, on a weighed row, missing), not
     *  a computed figure. Show it differently. */
    incomplete: boolean;
}

export interface PurchaseListReport {
    rows: PurchaseListRow[];
    /** Distinct orders behind the numbers. */
    orderCount: number;
    /** Order lines read — unpaginated by design. */
    lineCount: number;
    /** Rows where some of the quantity is an assumption rather than a measurement. */
    incompleteCount: number;
}

export interface PurchaseListInput {
    /** ISO-8601 — inclusive start of the order-placed window */
    from: string;
    /** ISO-8601 — inclusive end */
    to: string;
    /** Omit for the caller's active channel. Never pass __default_channel__
     *  alongside a city channel — every order belongs to both. */
    channelIds?: string[];
    /** Order states to include. Omit for the backend's outstanding-orders set
     *  (excludes Delivered, Cancelled, AddingItems, CancellationRequested). */
    states?: string[];
}

// ─── API ─────────────────────────────────────────────────────────────

export async function fetchPurchaseListReport(
    input: PurchaseListInput,
    channelToken?: string,
): Promise<PurchaseListReport> {
    const { data, errors } = await vendureFetch<{
        purchaseListReport: PurchaseListReport;
    }>(PURCHASE_LIST_REPORT_QUERY, { input }, channelToken);

    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[PurchaseListReport] API error:', msg, JSON.stringify(errors));
        if (data?.purchaseListReport) return data.purchaseListReport;
        throw new Error(msg || 'Failed to fetch purchase list report');
    }
    if (!data?.purchaseListReport) throw new Error('No purchase list report data returned');
    return data.purchaseListReport;
}

// ─── Display order ───────────────────────────────────────────────────

/** Marks a cleaned ("cut") keerai row — e.g. "முருங்கைகீரை (ஆய்ந்தது)". */
const KEERAI_CUT_MARKER = 'ஆய்ந்த';

/** Base product name: the label up to its first bracket, whitespace removed,
 *  so "முருங்கைகீரை (ஆய்ந்தது)" and "முருங்கைகீரை(250gm கட்டு)" share a key.
 *  Deliberately ignores ordNo: the cut row is usually tagged into the
 *  vegetables section while the bundle sits in the keerai section, and the
 *  cut row must follow the bundle across sections. */
function purchaseBaseKey(r: PurchaseListRow): string {
    return r.label.normalize('NFC').split(/[(（]/)[0].replace(/\s+/g, '');
}

function isKeeraiCutRow(r: PurchaseListRow): boolean {
    return r.label.normalize('NFC').includes(KEERAI_CUT_MARKER);
}

/**
 * Moves each cut keerai row (ஆய்ந்தது) to sit directly below its uncut
 * counterpart(s), even when the two are in different sections. Everything else keeps the backend's
 * order; a cut row with no uncut sibling stays where it was.
 */
export function orderKeeraiCutBelowWhole(rows: readonly PurchaseListRow[]): PurchaseListRow[] {
    const lastWholeIndex = new Map<string, number>();
    const cutByKey = new Map<string, PurchaseListRow[]>();
    rows.forEach((r, i) => {
        const key = purchaseBaseKey(r);
        if (isKeeraiCutRow(r)) {
            const list = cutByKey.get(key) ?? [];
            list.push(r);
            cutByKey.set(key, list);
        } else {
            lastWholeIndex.set(key, i);
        }
    });

    const out: PurchaseListRow[] = [];
    rows.forEach((r, i) => {
        const key = purchaseBaseKey(r);
        if (isKeeraiCutRow(r)) {
            // Emitted after its uncut sibling instead, when one exists.
            if (!lastWholeIndex.has(key)) out.push(r);
            return;
        }
        out.push(r);
        if (lastWholeIndex.get(key) === i) out.push(...(cutByKey.get(key) ?? []));
    });
    return out;
}
