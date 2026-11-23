/**
 * Price-change history service — SuperAdmin-only audit log of variant/channel
 * price edits.
 *
 * Sent with the DEFAULT (master) channel token (reusing
 * `fetchDefaultChannelToken` from the price-matrix service) because the backend
 * gates this query on the SuperAdmin permission, not on the channel. Prices
 * cross the wire as integer minor units (paise) — convert at the UI boundary
 * via `lib/price.ts`.
 */

import { vendureFetch } from '@/graphql/client';
import {
    PRICE_CHANGE_HISTORY_QUERY,
    PRICE_SYNC_BATCHES_QUERY,
} from '@/graphql/operations/price-history';
import { fetchDefaultChannelToken } from '@/services/price-matrix.service';

export interface PriceChangeLogItem {
    id: string;
    createdAt: string;
    variantName: string;
    channelName: string;
    oldPrice: number | null; // minor units
    newPrice: number; // minor units
    currencyCode: string;
    adminName: string;
}

export interface PriceHistoryFilters {
    variantId?: string;
    channelId?: string;
    adminId?: string;
    from?: string; // ISO date
    to?: string; // ISO date
    skip?: number;
    take?: number;
}

export async function fetchPriceChangeHistory(
    filters: PriceHistoryFilters = {},
): Promise<{ items: PriceChangeLogItem[]; totalItems: number }> {
    const token = await fetchDefaultChannelToken();
    const { data } = await vendureFetch<{
        priceChangeHistory: { items: PriceChangeLogItem[]; totalItems: number };
    }>(PRICE_CHANGE_HISTORY_QUERY, { options: { take: 25, skip: 0, ...filters } }, token);
    return data.priceChangeHistory;
}

export interface PriceSyncBatchItem {
    id: string;
    createdAt: string;
    channelCode: string;
    variantCount: number;
    affectedOrders: number;
    syncedNow: number;
    queuedCount: number;
}

export async function fetchPriceSyncBatches(
    options: { skip?: number; take?: number } = {},
): Promise<{ items: PriceSyncBatchItem[]; totalItems: number; pendingInQueue: number }> {
    const token = await fetchDefaultChannelToken();
    const { data } = await vendureFetch<{
        priceSyncBatches: {
            items: PriceSyncBatchItem[];
            totalItems: number;
            pendingInQueue: number;
        };
    }>(PRICE_SYNC_BATCHES_QUERY, { options: { take: 25, skip: 0, ...options } }, token);
    return data.priceSyncBatches;
}
