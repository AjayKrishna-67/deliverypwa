/**
 * Price-matrix service — tag search + variant x channel price grid.
 *
 * Every call is sent with the DEFAULT (master) channel token, fetched once via
 * `fetchDefaultChannelToken`. Tags are now GLOBAL (usable from any channel), so
 * the token no longer gates tag search; master is used only because every
 * product is assigned to the master channel (superset), so the product set
 * resolves there. Each matrix row lists that variant's assigned channels.
 *
 * Prices cross the wire as integer minor units (paise). Convert at the UI
 * boundary only — see `lib/price.ts`.
 */

import { vendureFetch } from '@/graphql/client';
import {
    CHANNEL_TOKENS_QUERY,
    TAG_SUGGESTIONS_QUERY,
    VARIANT_PRICE_MATRIX_QUERY,
    SET_VARIANT_CHANNEL_PRICES_MUTATION,
} from '@/graphql/operations/price-matrix';

// ─── Types ───────────────────────────────────────────────────────────

export interface TagSuggestion {
    id: string;
    value: string;
    productCount: number;
    variantCount: number;
}

export interface MatrixChannel {
    id: string;
    code: string;
    currencyCode: string;
}

export interface MatrixCell {
    channelId: string;
    currencyCode: string;
    price: number | null; // minor units (paise); null = assigned, no price yet
    assigned: boolean;
}

export interface MatrixRow {
    variantId: string;
    productId: string;
    name: string;
    sku: string;
    cells: MatrixCell[];
}

export interface VariantPriceMatrix {
    totalItems: number;
    channels: MatrixChannel[];
    rows: MatrixRow[];
}

export interface PriceUpdate {
    variantId: string;
    channelId: string;
    price: number; // minor units
}

// ─── Default channel token (cached for the session) ──────────────────

let defaultTokenPromise: Promise<string> | null = null;

export function fetchDefaultChannelToken(): Promise<string> {
    if (!defaultTokenPromise) {
        defaultTokenPromise = vendureFetch<{
            channels: { items: Array<{ code: string; token: string }> };
        }>(CHANNEL_TOKENS_QUERY).then(({ data }) => {
            const def = data.channels.items.find((c) => c.code === '__default_channel__');
            if (!def) {
                throw new Error('Default channel not found');
            }
            return def.token;
        });
    }
    return defaultTokenPromise;
}

// ─── Operations ──────────────────────────────────────────────────────

export async function fetchTagSuggestions(term: string): Promise<TagSuggestion[]> {
    const token = await fetchDefaultChannelToken();
    const { data } = await vendureFetch<{ tagSuggestions: TagSuggestion[] }>(
        TAG_SUGGESTIONS_QUERY,
        { term },
        token,
    );
    return data.tagSuggestions;
}

export async function fetchVariantPriceMatrix(args: {
    tagIds: string[];
    matchMode?: 'AND' | 'OR';
    skip?: number;
    take?: number;
}): Promise<VariantPriceMatrix> {
    const token = await fetchDefaultChannelToken();
    const { data } = await vendureFetch<{ variantPriceMatrix: VariantPriceMatrix }>(
        VARIANT_PRICE_MATRIX_QUERY,
        {
            tagIds: args.tagIds,
            matchMode: args.matchMode ?? 'OR',
            options: { skip: args.skip ?? 0, take: args.take ?? 25 },
        },
        token,
    );
    return data.variantPriceMatrix;
}

export async function saveVariantChannelPrices(
    updates: PriceUpdate[],
): Promise<{ updatedCount: number; variantIds: string[] }> {
    const token = await fetchDefaultChannelToken();
    const { data } = await vendureFetch<{
        setVariantChannelPrices: { updatedCount: number; variantIds: string[] };
    }>(SET_VARIANT_CHANNEL_PRICES_MUTATION, { updates }, token);
    return data.setVariantChannelPrices;
}
