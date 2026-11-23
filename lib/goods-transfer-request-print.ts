/**
 * Printing a product request.
 *
 * The same sheet the Purchase List prints — same builder, same paginator, same
 * black-and-white A4 — because the branches read the two side by side and a lookalike
 * is worse than a copy. Only the line above the table differs, and the date on it,
 * which is TODAY on the machine doing the printing rather than anything the server
 * decided.
 *
 * WHERE THE NAMES COME FROM
 *
 * The catalogue, and nothing else. Two names exist for every line and the picker on
 * the screen chooses between them:
 *
 *   Manglish  the name Vendure holds — the VARIANT's name on a per-variant line, the
 *             PRODUCT's on a pooled one, because a pooled line IS the product and has
 *             no variant to name it.
 *   Tamil     `customFields.localName`, read off the variant and falling back to the
 *             product. Blank there prints the Vendure name instead: a picking list
 *             with an empty row is a row nobody can pick.
 *
 * NO PRODUCT MASTER. This used to fall through to the Excel file when `localName` was
 * empty, matching on SKU, then on name, then on a shared prefix. Every one of those
 * steps guessed, and the last guessed worst: the master is a list of SELLABLE rows, so
 * every English name in it carries a size. A pooled product called "Ginger" has no row
 * of its own there, and the closest match it could find was "Ginger 100gm" — a size the
 * line does not have, printed against a product-level quantity.
 *
 * The catalogue cannot make that mistake. It holds exactly one name for a product and
 * one for a variant, and a pooled line asks for the first. Where `localName` is unset
 * the sheet says so plainly in English rather than inventing a Tamil name for it, and
 * the fix is one field on one product rather than a spreadsheet row nobody can find.
 *
 * ORDER
 *
 * Alphabetical, by the name that actually printed — so the Tamil sheet runs in Tamil
 * order and the Manglish one in English order, each sorted by the words on it. The
 * lines arrive in the order somebody ticked them, which is no order at all to anyone
 * walking a shelf.
 */

import {
    browserPrintDate,
    buildPurchaseListDocument,
    type PurchaseListRow,
} from '@/lib/purchase-list-document';

/** The part of a transfer line this sheet needs. */
export interface RequestPrintLine {
    /**
     * What the catalogue calls this line: the variant's name, or the product's on a
     * pooled line. Resolved by the caller, which is the only place that knows whether
     * a variant is involved.
     */
    readonly productName: string;
    readonly sku: string;
    readonly isPooled: boolean;
    readonly quantityPcs: number | null;
    readonly weightKg: number | null;
    /**
     * `customFields.localName` for this line — the variant's, else the product's.
     *
     * The only source of a Tamil name. Unset means the sheet prints `productName`,
     * which is honest and fixable; it never means a blank row.
     */
    readonly localName?: string | null;
    /**
     * How many packets this line is, when the product is sold in them — printed
     * beside the name as "X 3". See PurchaseListRow.packCount.
     */
    readonly packCount?: number | null;
}

/**
 * Which of the catalogue's two names the sheet prints.
 *
 * Whether the person picking the goods reads Tamil script is a fact about that person,
 * not about the branch or the product, so it is a choice on the screen rather than a
 * rule in here.
 */
export type RequestPrintLanguage = 'tamil' | 'manglish';

/** What one print did, so the screen can say when a sheet is not what was asked for. */
export interface RequestPrintReport {
    /** Lines that printed a local name. */
    named: number;
    /**
     * Lines that fell back to the Vendure name, and what they were called.
     *
     * Only ever populated for a Tamil print: Manglish asks for the Vendure name, so it
     * cannot fail to find one.
     */
    unnamed: string[];
}

/**
 * The name to print for one line.
 *
 * Exported because the screens show the same choice on screen that they print, and two
 * copies of this rule would drift the first time one of them changed.
 */
export function resolvePrintName(
    line: RequestPrintLine,
    language: RequestPrintLanguage,
): string {
    if (language === 'tamil') {
        const local = String(line.localName ?? '').trim();
        if (local) {
            return local;
        }
    }
    return line.productName;
}

/**
 * Open the request as a printable sheet.
 *
 * `ownerChannelCode` is the branch the PRODUCTS belong to — the branch that asked. It
 * is printed in the header and nothing else: several branches ask on the same day and
 * the sheets are otherwise identical, so the name is the only thing on the page that
 * tells two piles apart.
 */
export async function printItemRequest(options: {
    lines: readonly RequestPrintLine[];
    ownerChannelCode: string | null;
    /** Which of the catalogue's two names to print. Tamil unless told otherwise. */
    language?: RequestPrintLanguage;
    /** Opened before the await, so the browser still counts it as a user gesture. */
    windowRef?: Window | null;
}): Promise<RequestPrintReport> {
    const { lines, ownerChannelCode } = options;
    const language: RequestPrintLanguage = options.language ?? 'tamil';

    const unnamed: string[] = [];
    const rows: PurchaseListRow[] = lines.map((l) => {
        const name = resolvePrintName(l, language);
        if (language === 'tamil' && !String(l.localName ?? '').trim()) {
            unnamed.push(l.productName);
        }
        return {
            name,
            // Pieces and kilos share one column, the same as the purchase list: what
            // is being asked for is a quantity, and the unit is a property of the
            // product the picking branch already knows.
            qty: l.isPooled ? (l.weightKg ?? 0) : (l.quantityPcs ?? 0),
            packCount: l.packCount,
        };
    });

    /*
      A→Z on the printed name, with Tamil collation.

      Sorted on the NAME rather than on anything underneath it, so each sheet reads in
      the order of the words actually on it — the Tamil one in Tamil order, the Manglish
      one in English. `localeCompare(…, 'ta')` is the same call the Purchase List uses,
      and it handles both scripts: Tamil letters order by the Tamil alphabet, Latin ones
      fall through to their own.
    */
    rows.sort((a, b) => a.name.localeCompare(b.name, 'ta'));

    const html = buildPurchaseListDocument({
        title: 'Purchase Request List',
        headerDate: browserPrintDate(),
        rows,
        logoUrl: `${window.location.origin}/kaaikani_logo.png`,
        // Read off a shelf with the sheet in one hand, so the number has to carry
        // further than the report's does. Only this sheet asks for it.
        qtyFontSize: '12pt',
        headerBranch: ownerChannelCode,
    });

    const w = options.windowRef ?? window.open('', '_blank');
    if (!w) {
        throw new Error('The print window was blocked — allow pop-ups for this site.');
    }
    w.document.open();
    w.document.write(html);
    w.document.close();

    return { named: lines.length - unnamed.length, unnamed };
}
