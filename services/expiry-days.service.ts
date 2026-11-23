/**
 * Expiry Days report service — every product variant of the channel with its
 * shelf life, read in pages from the Admin API (needs ReadCatalog/ReadProduct).
 */

import { vendureFetch } from '@/graphql/client';
import { VARIANT_EXPIRY_DAYS_QUERY } from '@/graphql/operations/expiry-days';
import type { VariantExpiry } from '@/lib/expiry-days';

/** Below the backend's adminListQueryLimit (2000). */
const PAGE_SIZE = 1000;

interface VariantPage {
    totalItems: number;
    items: Array<{
        id: string;
        name: string;
        sku: string;
        enabled: boolean;
        customFields: { expiryDays: number | null } | null;
    }>;
}

export async function fetchVariantExpiryDays(channelToken: string): Promise<VariantExpiry[]> {
    const all: VariantExpiry[] = [];
    let skip = 0;
    for (;;) {
        const { data } = await vendureFetch<{ productVariants: VariantPage }>(
            VARIANT_EXPIRY_DAYS_QUERY,
            { options: { skip, take: PAGE_SIZE, sort: { id: 'ASC' } } },
            channelToken,
        );
        const page = data.productVariants;
        for (const v of page.items) {
            all.push({
                id: v.id,
                name: v.name,
                sku: v.sku ?? '',
                enabled: v.enabled,
                expiryDays: v.customFields?.expiryDays ?? null,
            });
        }
        skip += page.items.length;
        if (page.items.length === 0 || skip >= page.totalItems) return all;
    }
}
