/**
 * Monthly product sales report service — aggregates placed (non-cancelled)
 * orders by product within a date range. Backend gates on `ViewBusinessReports`.
 */

import { vendureFetch } from '@/graphql/client';
import { MONTHLY_PRODUCT_SALES_REPORT_QUERY } from '@/graphql/operations/monthly-product-sales';

// ─── Types ───────────────────────────────────────────────────────────

export interface MonthlyProductFacetSummary {
    id: string;
    name: string;
}

export interface MonthlyProductSalesRow {
    productId: string;
    productName: string;
    /** Facet values the product belongs to. When the facetIds filter is
     *  active, only matching facets are listed; otherwise all facets the
     *  product belongs to. */
    facets: MonthlyProductFacetSummary[];
    totalQuantitySold: number;
    /** Aggregate sales amount in paise */
    totalSalesAmount: number;
}

export interface MonthlyProductSales {
    items: MonthlyProductSalesRow[];
    totalItems: number;
    totalQuantitySold: number;
    /** Aggregate across the full result set, in paise */
    totalSalesAmount: number;
}

export interface MonthlyProductSalesInput {
    /** ISO-8601 — inclusive start of date range */
    from: string;
    /** ISO-8601 — inclusive end of date range */
    to: string;
    /** Optional — if omitted, backend uses caller's active channel */
    channelIds?: string[];
    /** Optional — restrict to specific facet IDs */
    facetIds?: string[];
    skip?: number;
    take?: number;
}

// ─── API ─────────────────────────────────────────────────────────────

export async function fetchMonthlyProductSales(
    input: MonthlyProductSalesInput,
    channelToken?: string,
): Promise<MonthlyProductSales> {
    const { data, errors } = await vendureFetch<{
        monthlyProductSalesReport: MonthlyProductSales;
    }>(MONTHLY_PRODUCT_SALES_REPORT_QUERY, { input }, channelToken);

    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[MonthlyProductSales] API error:', msg, JSON.stringify(errors));
        if (data?.monthlyProductSalesReport) {
            return data.monthlyProductSalesReport;
        }
        throw new Error(msg || 'Failed to fetch monthly product sales report');
    }
    if (!data?.monthlyProductSalesReport) {
        throw new Error('No monthly product sales data returned');
    }
    return data.monthlyProductSalesReport;
}
