/**
 * Location-stock service — location-first stock view + per-row absolute save.
 *
 * Every call runs under the DEFAULT (master) channel token. Catalog tags are
 * now GLOBAL and every product lives on the default channel, so scoping to a
 * city channel would hide products not assigned to it. The caller passes the
 * default token (resolved via fetchDefaultChannelToken), mirroring price-matrix.
 * Stock values cross the wire as integers in the variant's BASE unit; convert at
 * the UI boundary (see lib/stock-units.ts).
 *
 * There is NO bulk save — each row is written on its own explicit save, the
 * anti-Excel guarantee carried from the backend design.
 */

import { vendureFetch } from '@/graphql/client';
import {
    LOCATION_PRODUCT_POOL_STOCK_QUERY,
    LOCATION_VARIANT_STOCK_QUERY,
    SET_PRODUCT_POOL_STOCK_MUTATION,
    SET_VARIANT_STOCK_ON_HAND_MUTATION,
    STOCK_CATALOG_TAGS_QUERY,
    STOCK_LOCATIONS_QUERY,
} from '@/graphql/operations/location-stock';

// ─── Types ───────────────────────────────────────────────────────────

export interface StockLocationOption {
    id: string;
    name: string;
}

export interface CatalogTagOption {
    id: string;
    value: string;
}

export interface VariantStockRow {
    variantId: string;
    productId: string;
    sku: string;
    name: string;
    stockUnit: string;
    baseUnit: 'g' | 'ml' | 'piece';
    stockOnHand: number;
    stockAllocated: number;
}

export interface ProductPoolStockRow {
    productId: string;
    name: string;
    hasPoolHere: boolean;
    stockOnHand: number | null;
    stockAllocated: number;
}

export interface StockFilter {
    stockLocationId: string;
    tagIds?: string[];
    search?: string;
}

// ─── Reads (scoped to the selected channel) ──────────────────────────

export async function fetchStockLocations(channelToken: string): Promise<StockLocationOption[]> {
    const { data } = await vendureFetch<{ stockLocations: { items: StockLocationOption[] } }>(
        STOCK_LOCATIONS_QUERY,
        {},
        channelToken,
    );
    return data.stockLocations.items;
}

export async function fetchStockTags(channelToken: string): Promise<CatalogTagOption[]> {
    const { data } = await vendureFetch<{ catalogTags: CatalogTagOption[] }>(
        STOCK_CATALOG_TAGS_QUERY,
        {},
        channelToken,
    );
    return data.catalogTags;
}

export async function fetchVariantStock(
    filter: StockFilter,
    channelToken: string,
): Promise<VariantStockRow[]> {
    const { data } = await vendureFetch<{ locationVariantStock: VariantStockRow[] }>(
        LOCATION_VARIANT_STOCK_QUERY,
        {
            stockLocationId: filter.stockLocationId,
            tagIds: filter.tagIds?.length ? filter.tagIds : undefined,
            matchMode: 'OR',
            search: filter.search || undefined,
        },
        channelToken,
    );
    return data.locationVariantStock;
}

export async function fetchProductPoolStock(
    filter: StockFilter,
    channelToken: string,
): Promise<ProductPoolStockRow[]> {
    const { data } = await vendureFetch<{ locationProductPoolStock: ProductPoolStockRow[] }>(
        LOCATION_PRODUCT_POOL_STOCK_QUERY,
        {
            stockLocationId: filter.stockLocationId,
            tagIds: filter.tagIds?.length ? filter.tagIds : undefined,
            matchMode: 'OR',
            search: filter.search || undefined,
        },
        channelToken,
    );
    return data.locationProductPoolStock;
}

// ─── Writes (per row, absolute) ──────────────────────────────────────

export async function saveVariantStock(
    input: { variantId: string; stockLocationId: string; stockOnHand: number },
    channelToken: string,
): Promise<boolean> {
    const { data } = await vendureFetch<{ setVariantStockOnHand: boolean }>(
        SET_VARIANT_STOCK_ON_HAND_MUTATION,
        { input },
        channelToken,
    );
    return data.setVariantStockOnHand;
}

export async function saveProductPoolStock(
    input: { productId: string; stockLocationId: string; stockOnHand: number },
    channelToken: string,
): Promise<boolean> {
    const { data } = await vendureFetch<{ setProductPoolStock: boolean }>(
        SET_PRODUCT_POOL_STOCK_MUTATION,
        { input },
        channelToken,
    );
    return data.setProductPoolStock;
}
