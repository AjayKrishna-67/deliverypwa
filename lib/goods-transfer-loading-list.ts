/**
 * The loading list — what goes on the lorry in total, across every branch on the run.
 *
 * WHAT IT ANSWERS, and why it is not the trip note. The trip note is per branch,
 * because each branch signs for its own consignment. Nobody loads a lorry that way:
 * the godown wants one figure per product for the whole trip, so two branches each
 * taking tomatoes should read as one line to weigh out, not two to add up by hand.
 *
 * WHY THE LOCAL NAME IS THE KEY. The branches keep SEPARATE catalogues. The same
 * vegetable is a different product row in each, with its own id, its own SKU and
 * usually its own English spelling — Idukki's "Uzhunnu Kanji Mix 100gm" and
 * Madurai's "Black Urad Dal Porridge Mix 100gm" are one thing to weigh out and
 * nothing at all to match on. What they share is the name a shopper reads, which the
 * Dashboard stores as Product.customFields.localName (and the variant's counterpart).
 * That is the only field that identifies the same goods in two branches.
 *
 * THE RULE, exactly as asked for: same local name, quantities add up; different local
 * name, a separate line. A pack size is part of the name, so 250 g and 500 g of the
 * same vegetable stay apart — they are different things to pick.
 *
 * WHEN THERE IS NO LOCAL NAME the English name stands in and the line is MARKED. The
 * alternative — refusing to match — would put every such product on its own row per
 * branch and quietly present that as a loading list, which is worse than saying so.
 * A marked row is also a useful thing to see: it names a product whose Local Name box
 * is still empty in the Dashboard.
 *
 * Nothing here talks to the network or to React, so it can be run over real data and
 * checked.
 */

import { STOCK_UNITS } from '@/lib/stock-units';

/** One line as the server returned it, unmerged. */
export interface LoadingListRow {
    /** The far end: where this is going when sending, where it is from when receiving. */
    branchCode: string;
    transferNumber: string;
    /** The English name, snapshotted onto the line when it was added. */
    productName: string;
    /** The shopper-facing name, or null when nobody has entered one. */
    localName: string | null;
    /** Empty for pooled products — they are entered at product level, with no variant. */
    sku: string;
    quantityPcs: number | null;
    /** The pool quantity as stored: an integer in the base unit named by poolUnit. */
    weightGrams: number | null;
    /** 'kg', 'litre' or 'piece'. Null on a counted (variant) line. */
    poolUnit: string | null;
}

export interface MergedShare {
    branchCode: string;
    /** Same unit as the item's total. */
    quantity: number;
}

/**
 * What a merged total counts, and at what level it was entered.
 *
 * Four values rather than two, because a POOL is not necessarily a weight: Amla and
 * Lemon are pooled and counted in pieces. While this was 'weight' | 'pcs', every
 * pooled line was called a weight and the sheet printed "30.000 kg" beside thirty
 * lemons.
 *
 *   weight     pooled, held in grams      -> printed in kg
 *   volume     pooled, held in millilitres -> printed in litres
 *   poolCount  pooled, held in pieces      -> printed as a count
 *   pcs        a VARIANT count             -> printed as a count
 *
 * poolCount and pcs both print a count and still must not merge. A pooled line
 * counts the thing itself — one amla — where a variant line counts packs of it, and
 * "Amla 10 no." is ten amlas per unit. Adding the two produces a number that is true
 * of nothing, exactly as adding kilograms to pieces would.
 */
export type LoadingMeasure = 'weight' | 'volume' | 'poolCount' | 'pcs';

export interface MergedItem {
    /** What the lines were matched on, when the products carried one. */
    localName: string | null;
    /** What the branches call it. Usually one; more when the English names differ. */
    productNames: string[];
    /** Goods measured differently never merge into each other. */
    measure: LoadingMeasure;
    /** In the measure's base unit: grams, millilitres or a count. */
    total: number;
    /** Every branch this is going to, and how much each is taking. */
    shares: MergedShare[];
    /**
     * True when the products carried no local name and the English name had to stand
     * in. Marked on the sheet — see the note at the top of this file.
     */
    matchedOnEnglishName: boolean;
}

/**
 * How a row is measured, from the line's own unit.
 *
 * A row with a pool quantity is pooled; what it counts is then decided by poolUnit,
 * never assumed. Anything else is a variant count.
 */
function measureOf(row: LoadingListRow): LoadingMeasure {
    if (row.weightGrams == null) {
        return 'pcs';
    }
    switch (STOCK_UNITS[row.poolUnit ?? '']?.baseUnit) {
        case 'g':
            return 'weight';
        case 'ml':
            return 'volume';
        default:
            // Includes a legacy row with no unit recorded. A count is the safer
            // reading of an unknown: it prints the stored figure as it stands,
            // where calling it grams would divide it by a thousand.
            return 'poolCount';
    }
}

/** Collapses spacing and case so two spellings of one name meet. */
function normalise(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Merge the rows into one line per product.
 *
 * Goods measured differently are keyed apart even under the same name. Adding 24
 * pieces to 30 kilograms produces a number that is true of nothing, and a product
 * carried both ways in two branches is a data problem to be seen rather than summed
 * into silence.
 *
 * The key is safe to build by concatenation because `measure` is a closed set of
 * four words and comes first: no product name can make one key look like another.
 */
export function mergeLoadingList(rows: LoadingListRow[]): MergedItem[] {
    const byKey = new Map<string, MergedItem>();

    for (const row of rows) {
        const measure = measureOf(row);
        const quantity = (measure === 'pcs' ? row.quantityPcs : row.weightGrams) ?? 0;
        if (quantity <= 0) {
            continue;
        }

        const localName = row.localName?.trim() || null;
        const key = localName
            ? `${measure}|local|${normalise(localName)}`
            : `${measure}|english|${normalise(row.productName)}`;

        const found = byKey.get(key);
        if (!found) {
            byKey.set(key, {
                localName,
                productNames: [row.productName],
                measure,
                total: quantity,
                shares: [{ branchCode: row.branchCode, quantity }],
                matchedOnEnglishName: !localName,
            });
            continue;
        }

        found.total += quantity;
        if (!found.productNames.includes(row.productName)) {
            found.productNames.push(row.productName);
        }
        // A branch taking the same product on two transfers of one run is still one
        // share — the godown weighs it out once.
        const share = found.shares.find((s) => s.branchCode === row.branchCode);
        if (share) {
            share.quantity += quantity;
        } else {
            found.shares.push({ branchCode: row.branchCode, quantity });
        }
    }

    const items = [...byKey.values()];
    for (const item of items) {
        item.shares.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
        item.productNames.sort((a, b) => a.localeCompare(b));
    }

    /*
      Named lines first, in local-name order; the unnamed ones after them.

      Those last rows are the ones worth a second look — each is a product whose
      Local Name box is empty — and putting them together at the end makes them
      something a person can act on in one go rather than marks scattered down a page.
    */
    return items.sort((a, b) => {
        if (a.matchedOnEnglishName !== b.matchedOnEnglishName) {
            return a.matchedOnEnglishName ? 1 : -1;
        }
        const an = a.localName ?? a.productNames[0] ?? '';
        const bn = b.localName ?? b.productNames[0] ?? '';
        return an.localeCompare(bn) || a.measure.localeCompare(b.measure);
    });
}

/** How many lines the merge actually brought together — the sheet says so. */
export function mergeSummary(items: MergedItem[]): {
    products: number;
    shared: number;
    unnamed: number;
} {
    return {
        products: items.length,
        shared: items.filter((i) => i.shares.length > 1).length,
        unnamed: items.filter((i) => i.matchedOnEnglishName).length,
    };
}
