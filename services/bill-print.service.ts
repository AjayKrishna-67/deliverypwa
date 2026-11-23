/**
 * Bill print report service. Backend gates on `ViewBusinessReports`.
 * Each row = one order line with bill-level info repeated. The UI groups
 * rows by `code` to assemble a printable bill.
 */

import { vendureFetch } from '@/graphql/client';
import {
    BILL_PRINT_REPORT_QUERY,
    BILL_PRINT_REPORT_QUERY_LEGACY,
    AVAILABLE_ORDER_STATES_QUERY,
} from '@/graphql/operations/bill-print';

// ─── Types ───────────────────────────────────────────────────────────

export type BillPaymentType = 'ONLINE' | 'COD';

/** One promotional discount applied to an order (coupon, loyalty, etc.). */
export interface BillPrintDiscount {
    /** Human-readable label (e.g. "OFFER 249", "Loyalty Points Discount") */
    description: string;
    /** Coupon code if from a coupon promotion (e.g. "OFFER249"); null for loyalty/non-coupon */
    code: string | null;
    /** Backend adjustment source (e.g. "PROMOTION:5", "SURCHARGE:7") */
    source: string;
    /** Discount amount in paise — POSITIVE; treat as deduction */
    amount: number;
}

/** All money fields are in paise (Int), like other reports. Divide by 100 for display. */
export interface BillPrintRow {
    id: string;
    /** Order code (groups multiple lines into one bill) */
    code: string;
    pCode: string | null;
    /** Pre-formatted date string from backend (e.g. "28-04-2026") */
    date: string;
    /** Pre-formatted time string (e.g. "18:25:50") */
    time: string;
    billingAddress: string;
    itemName: string;
    qty: number;
    /** MRP in paise */
    shadowPrice: number;
    /** Per-unit selling rate in paise */
    rate: number;
    /** Line total = qty × rate, in paise */
    total: number;
    /** Bill-level subtotal in paise (repeated on every row of this bill) */
    subTotal: number;
    /** Bill-level shipping in paise (final, post-discount) */
    shipping: number;
    /** What shipping WOULD have cost before any free-shipping promo (paise).
     *  Equals `shipping` if no shipping promo applied. */
    originalShipping: number;
    /** Bill-level net total in paise */
    netTotal: number;
    /** HSN/SAC code from Product custom field. Null if not classified. */
    hsnCode: string | null;
    /** GST rate applied to this line — e.g. 5.0 for 5%. Frontend splits 50:50
     *  into CGST/SGST for display (intra-state retail). */
    taxRate: number;
    /** Tax included in this line, in paise.
     *  Equals total - priceBeforeTax. */
    taxAmount: number;
    /** Line total BEFORE tax, in paise. priceBeforeTax + taxAmount === total. */
    priceBeforeTax: number;
    /** Bill-level total tax across all lines, in paise (repeated on every row). */
    totalTaxAmount: number;
    deliveryTime: string | null;
    cuttingInstructions: string | null;
    paymentMode: string | null;
    paymentMethod: string | null;
    paymentMetadata: string | null;
    /** Final classification accounting for admin "bill paid" reconciliation overrides */
    paymentType: BillPaymentType;
    /** True when admin added a "bill paid" note in order history (offline → online override) */
    adminMarkedAsPaid: boolean;
    ordNo: string | null;
    customerId: string | null;
    rewardPointUsed: number | null;
    /** Same value as rewardPointUsed — count of loyalty points redeemed (not money) */
    loyaltyPointsUsed: number | null;
    /** Customer's current total reward-point balance (Customer.loyaltyPointsAvailable),
     *  repeated on every row. Shown on the invoice footer. */
    loyaltyPointsAvailable: number | null;
    couponCode: string | null;
    /** All promotional discounts applied (coupon, loyalty, etc.). Excludes shipping promo
     *  which is reflected via `originalShipping` − `shipping` instead. */
    discounts: BillPrintDiscount[];
    note: string | null;
    /** Concatenated notes from Vendure order modifications (admin-entered during Modifying state). */
    orderModifyNote: string | null;
    invoiceNo: string;
    /** Line total after the coupon's item-level discounts (free product,
     *  % off a product), incl. GST, in paise. Null on rows cached before the
     *  backend added it — fall back to `total`. */
    discountedTotal?: number | null;
    /** Coupon gift product: priced, but the customer pays nothing for it. */
    isFree?: boolean | null;
}

export interface BillPrintReport {
    items: BillPrintRow[];
    totalItems: number;
}

export interface BillPrintInput {
    /** ISO-8601 — inclusive start */
    from: string;
    /** ISO-8601 — inclusive end */
    to: string;
    channelIds?: string[];
    /** Optional Vendure order states to filter on. NOTE: the backend
     *  (Reports plugin, orders-report.service.ts) does not read this field —
     *  every caller gets the hard-coded default, which now admits only
     *  PaymentAuthorized, PaymentSettled and Modifying. */
    states?: string[];
    skip?: number;
    take?: number;
}

// ─── API ─────────────────────────────────────────────────────────────

/** Fetch the list of Vendure order states. Used to populate the states
 *  multi-select on the Invoice Report. Returns an empty array on failure. */
export async function fetchAvailableOrderStates(channelToken?: string): Promise<string[]> {
    const { data, errors } = await vendureFetch<{ availableOrderStates: string[] }>(
        AVAILABLE_ORDER_STATES_QUERY,
        {},
        channelToken,
    );
    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[AvailableOrderStates] API error:', msg);
        return data?.availableOrderStates ?? [];
    }
    return data?.availableOrderStates ?? [];
}

export async function fetchBillPrintReport(
    input: BillPrintInput,
    channelToken?: string,
): Promise<BillPrintReport> {
    // A backend without the coupon line fields rejects the whole query (HTTP
    // 400, "Cannot query field ..."); ask again without them so the report
    // still loads — bills then fall back to list prices.
    const run = (query: string) =>
        vendureFetch<{ billPrintReport: BillPrintReport }>(query, { input }, channelToken);
    let result: Awaited<ReturnType<typeof run>>;
    try {
        result = await run(BILL_PRINT_REPORT_QUERY);
    } catch (err) {
        if (!isMissingCouponLineField(err)) throw err;
        result = await run(BILL_PRINT_REPORT_QUERY_LEGACY);
    }
    if (result.errors?.some(e => isMissingCouponLineField(e))) {
        result = await run(BILL_PRINT_REPORT_QUERY_LEGACY);
    }
    const { data, errors } = result;

    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[BillPrintReport] API error:', msg, JSON.stringify(errors));
        if (data?.billPrintReport) return data.billPrintReport;
        throw new Error(msg || 'Failed to fetch bill print report');
    }
    if (!data?.billPrintReport) throw new Error('No bill print report data returned');
    return data.billPrintReport;
}

/** The server does not know `discountedTotal` / `isFree` yet. */
export function isMissingCouponLineField(err: unknown): boolean {
    const message = err instanceof Error ? err.message : (err as { message?: string } | null)?.message ?? '';
    return /Cannot query field \\?"(discountedTotal|isFree)\\?"/.test(message);
}

// ─── Helpers ─────────────────────────────────────────────────────────

export interface GroupedBill {
    code: string;
    invoiceNo: string;
    date: string;
    time: string;
    billingAddress: string;
    deliveryTime: string | null;
    cuttingInstructions: string | null;
    paymentMode: string | null;
    paymentType: BillPaymentType;
    adminMarkedAsPaid: boolean;
    couponCode: string | null;
    /** All in paise */
    subTotal: number;
    shipping: number;
    originalShipping: number;
    netTotal: number;
    /** Sum of all line tax amounts on this bill (paise). */
    totalTaxAmount: number;
    rewardPointUsed: number | null;
    loyaltyPointsUsed: number | null;
    /** Customer's current total reward-point balance. */
    loyaltyPointsAvailable: number | null;
    discounts: BillPrintDiscount[];
    note: string | null;
    orderModifyNote: string | null;
    ordNo: string | null;
    lines: BillPrintRow[];
    /** Set when the bill prints as that channel's GST tax invoice instead of
     *  the Kaaikani bill — see lib/gst-invoice.ts. */
    gstInvoiceChannelId?: string | null;
}

export function groupBills(rows: BillPrintRow[]): GroupedBill[] {
    const map = new Map<string, GroupedBill>();
    for (const row of rows) {
        if (!map.has(row.code)) {
            map.set(row.code, {
                code: row.code,
                invoiceNo: row.invoiceNo,
                date: row.date,
                time: row.time,
                billingAddress: row.billingAddress,
                deliveryTime: row.deliveryTime,
                cuttingInstructions: row.cuttingInstructions,
                paymentMode: row.paymentMode,
                paymentType: row.paymentType,
                adminMarkedAsPaid: row.adminMarkedAsPaid,
                couponCode: row.couponCode,
                subTotal: row.subTotal,
                shipping: row.shipping,
                originalShipping: row.originalShipping,
                netTotal: row.netTotal,
                totalTaxAmount: row.totalTaxAmount,
                rewardPointUsed: row.rewardPointUsed,
                loyaltyPointsUsed: row.loyaltyPointsUsed,
                loyaltyPointsAvailable: row.loyaltyPointsAvailable,
                discounts: row.discounts ?? [],
                note: row.note,
                orderModifyNote: row.orderModifyNote,
                ordNo: row.ordNo,
                lines: [],
            });
        }
        map.get(row.code)!.lines.push(row);
    }
    return Array.from(map.values());
}
