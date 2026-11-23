/**
 * Catalogue names for bill lines — the Tamil (or Malayalam) name printed under
 * the English one, plus the facet data the packing lists sort and split by.
 *
 * Replaces the Excel product master (/api/tamil-names) for the Daily Sales
 * reports. The same facts now have catalogue homes in Vendure:
 *
 *   Tamil name    ProductVariant.customFields.localName
 *   OrdNo         FacetValue.customFields.purchaseOrdNo (lowest on the product)
 *   Category      the product's facet values
 *
 * Looked up by SKU — the bill rows' `pCode` — through the standard Admin API,
 * in chunks. Deliberately NOT cached here: a report keeps the names it loaded
 * with (see LoadedBills in the reports page), so the only time this runs again
 * is an explicit Apply — and that must show a name corrected in Vendure a
 * moment ago, not one remembered from the previous load.
 */

import { vendureFetch } from '@/graphql/client';
import { PRODUCT_VARIANTS_BY_SKU_QUERY } from '@/graphql/operations/product-names';

// ─── Types ───────────────────────────────────────────────────────────

export interface VariantFacetValue {
    id: string;
    name: string;
    /** Purchase-list section number; null when the value is not a section. */
    purchaseOrdNo: number | null;
}

export interface VariantNames {
    sku: string;
    variantId: string;
    variantName: string;
    /** ProductVariant.customFields.localName — null when the catalogue has none. */
    localName: string | null;
    productId: string;
    productName: string;
    /** Product.customFields.localName — the umbrella label (e.g. "மாதுளை"). */
    productLocalName: string | null;
    /** Every facet value on the product, any facet. */
    facetValues: VariantFacetValue[];
    /** Lowest purchaseOrdNo across the product's facet values; null when untagged. */
    purchaseOrdNo: number | null;
}

/** SKU → catalogue entry. A SKU the catalogue does not know is simply absent. */
export type VariantNameMap = Map<string, VariantNames>;

interface RawVariant {
    id: string;
    sku: string;
    name: string;
    customFields: { localName: string | null } | null;
    product: {
        id: string;
        name: string;
        customFields: { localName: string | null } | null;
        facetValues: Array<{
            id: string;
            name: string;
            customFields: { purchaseOrdNo: number | null } | null;
        }>;
    };
}

// ─── Mapping ─────────────────────────────────────────────────────────

/** SKUs per request — well under Vendure's list-query cap on any deployment. */
const SKU_CHUNK = 100;
/** Room for a SKU that exists on more than one variant. */
const TAKE_PER_CHUNK = 200;

function blank(s: string | null | undefined): string | null {
    const t = (s ?? '').trim();
    return t || null;
}

function toEntry(v: RawVariant): VariantNames {
    const facetValues: VariantFacetValue[] = (v.product?.facetValues ?? []).map((fv) => ({
        id: fv.id,
        name: fv.name,
        purchaseOrdNo: fv.customFields?.purchaseOrdNo ?? null,
    }));
    // Lowest tagged section wins — the sections are authored broadest-first
    // (1 = vegetables), so the smallest number is the aisle the buyer walks to.
    const ordNos = facetValues
        .map((fv) => fv.purchaseOrdNo)
        .filter((n): n is number => n != null && Number.isFinite(n));
    return {
        sku: v.sku,
        variantId: v.id,
        variantName: v.name,
        localName: blank(v.customFields?.localName),
        productId: v.product?.id ?? '',
        productName: v.product?.name ?? '',
        productLocalName: blank(v.product?.customFields?.localName),
        facetValues,
        purchaseOrdNo: ordNos.length ? Math.min(...ordNos) : null,
    };
}

// ─── API ─────────────────────────────────────────────────────────────

/**
 * Catalogue entries for the given SKUs, keyed by SKU.
 *
 * `channelToken` picks the channel the lookup runs in — a variant is only
 * visible through a channel it is assigned to, so pass one that carries the
 * bills' products (the default channel carries every product).
 *
 * Throws on API failure (permission, network). Callers that can print without
 * local names should catch and carry on.
 */
export async function fetchVariantNames(
    skus: Iterable<string>,
    channelToken?: string,
): Promise<VariantNameMap> {
    const wanted = [...new Set([...skus].map((s) => String(s).trim()).filter(Boolean))];
    const result: VariantNameMap = new Map();

    for (let i = 0; i < wanted.length; i += SKU_CHUNK) {
        const chunk = wanted.slice(i, i + SKU_CHUNK);
        const { data } = await vendureFetch<{ productVariants: { items: RawVariant[] } }>(
            PRODUCT_VARIANTS_BY_SKU_QUERY,
            { skus: chunk, take: TAKE_PER_CHUNK },
            channelToken,
        );
        for (const raw of data?.productVariants?.items ?? []) {
            const entry = toEntry(raw);
            const prev = result.get(entry.sku);
            // Two variants on one SKU: keep the one that actually has a local name.
            if (!prev || (!prev.localName && entry.localName)) result.set(entry.sku, entry);
        }
    }

    return result;
}
