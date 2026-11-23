/**
 * Sales report service — delivered orders within a date range,
 * for admin/accountant. Backend gates on `ViewBusinessReports`.
 */

import { vendureFetch } from '@/graphql/client';
import { SALES_REPORT_QUERY } from '@/graphql/operations/business-reports';

// ─── Types ───────────────────────────────────────────────────────────

export interface SalesReportRow {
    orderCode: string;
    orderStatus: string;
    /** Invoice number assigned at delivery — may be null for legacy orders */
    invoiceNo: string | null;
    /** subTotalWithTax in paise */
    orderAmount: number;
    /** subTotalWithTax + shippingWithTax in paise */
    netAmount: number;
    orderPlacedAt: string | null;
    /** ISO-8601 string */
    deliveredAt: string;
    channelId: string;
    channelCode: string;
}

export interface SalesReport {
    items: SalesReportRow[];
    totalItems: number;
    /** Aggregates across the full (unpaginated) result set, in paise */
    totalOrderAmount: number;
    totalNetAmount: number;
}

export interface SalesReportInput {
    /** ISO-8601 — inclusive start of delivery date range (filters order.updatedAt) */
    from: string;
    /** ISO-8601 — inclusive end of delivery date range (filters order.updatedAt) */
    to: string;
    /** Optional — if omitted, backend uses the caller's active channel */
    channelIds?: string[];
    skip?: number;
    take?: number;
}

// ─── API ─────────────────────────────────────────────────────────────

export async function fetchSalesReport(
    input: SalesReportInput,
    channelToken?: string,
): Promise<SalesReport> {
    const { data, errors } = await vendureFetch<{
        salesReport: SalesReport;
    }>(SALES_REPORT_QUERY, { input }, channelToken);

    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[SalesReport] API error:', msg, JSON.stringify(errors));
        if (data?.salesReport) {
            return data.salesReport;
        }
        throw new Error(msg || 'Failed to fetch sales report');
    }
    if (!data?.salesReport) {
        throw new Error('No sales report data returned');
    }
    return data.salesReport;
}
