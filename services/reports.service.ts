/**
 * Delivery reports service — fetches delivery report data
 * scoped by role (DP sees own, Admin/Accountant sees all).
 */

import { vendureFetch } from '@/graphql/client';
import { DELIVERY_REPORT_QUERY } from '@/graphql/operations/reports';

// ─── Types ───────────────────────────────────────────────────────────

export interface DeliveryFulfillmentDetailItem {
    orderCode: string;
    /** Order total in paise */
    orderTotal: number;
    /** Collection method: 'Cash' | 'QR' | 'Cash+QR' | null (online) */
    paymentCollectionMethod?: string | null;
    /** Collected amount in paise */
    collectedAmount?: number | null;
    /** Cash portion for Cash+QR orders (in paise) */
    qrCashAmount: number;
    /** QR portion for Cash+QR orders (in paise) */
    qrAmount: number;
    collectionNote?: string | null;
    deliveredAt?: string | null;
    customerName?: string | null;
}

export interface DeliveryPersonSummary {
    deliveryPersonId: string;
    deliveryPersonName: string;
    deliveryPersonPhone?: string | null;
    totalDeliveries: number;
    cashCount: number;
    qrCount: number;
    onlineCount: number;
    paymentLinkCount: number;
    /** All amounts in paise */
    totalCashAmount: number;
    totalQrAmount: number;
    totalOnlineAmount: number;
    totalPaymentLinkAmount: number;
    fulfillments: DeliveryFulfillmentDetailItem[];
}

export interface DeliveryReportData {
    /** 'DELIVERY_PERSON' | 'ACCOUNTANT' | 'ADMIN' */
    callerRole: string;
    summaries: DeliveryPersonSummary[];
    grandTotalDeliveries: number;
    grandTotalCashCount: number;
    grandTotalQrCount: number;
    grandTotalOnlineCount: number;
    grandTotalPaymentLinkCount: number;
    /** All amounts in paise */
    grandTotalCashAmount: number;
    grandTotalQrAmount: number;
    grandTotalOnlineAmount: number;
    grandTotalPaymentLinkAmount: number;
}

// ─── API ─────────────────────────────────────────────────────────────

/**
 * Fetch delivery report.
 * - DP role: auto-scoped to own deliveries (deliveryPersonId ignored)
 * - Admin/Accountant: overview of all DPs; pass deliveryPersonId for drill-down
 */
export async function fetchDeliveryReport(
    dateFrom: string,
    dateTo: string,
    deliveryPersonId?: string,
    skip?: number,
    take?: number,
    channelToken?: string,
): Promise<DeliveryReportData> {
    const input: Record<string, unknown> = { dateFrom, dateTo };
    if (deliveryPersonId) input.deliveryPersonId = deliveryPersonId;
    if (skip != null) input.skip = skip;
    if (take != null) input.take = take;

    const { data, errors } = await vendureFetch<{
        deliveryReport: DeliveryReportData;
    }>(DELIVERY_REPORT_QUERY, { input }, channelToken);

    if (errors?.length) {
        const msg = errors.map(e => e.message).join('; ');
        console.error('[DeliveryReport] API error:', msg, JSON.stringify(errors));
        // If we still got data despite errors, use it
        if (data?.deliveryReport) {
            return data.deliveryReport;
        }
        throw new Error(msg || 'Failed to fetch delivery report');
    }
    if (!data?.deliveryReport) {
        throw new Error('No delivery report data returned');
    }
    return data.deliveryReport;
}
