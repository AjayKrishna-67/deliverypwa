/**
 * Turning a loading list into a sheet that is read on screen and printed on paper —
 * and those are two different sheets.
 *
 * ON SCREEN the table carries everything: the local name, the English name behind it,
 * a quantity column per branch, and the total. That is the page for working out
 * which branch is taking what, and it stays open in its own tab.
 *
 * ON PAPER only ONE NAME and the TOTAL remain — the Local Name, or the product's own
 * Latin-letter name when the sheet is asked for in Manglish. The paper goes to the godown,
 * and the godown weighs out totals: the split between branches is the office's
 * question, not the picker's, and every extra column on a printed list is a column to
 * misread under a lorry. The narrowing is done by the print stylesheet, so there is
 * one document rather than two that could drift, and the browser's own Save as PDF
 * gives the two-column version because printing is what Save as PDF is.
 *
 * WHY THE PRINT LIVES HERE AND NOT IN THE BACKEND, where the trip note is built. The
 * sheet is headed by the local name of every product, and those are written in Tamil
 * or Malayalam. The backend draws its PDFs with pdfkit in Helvetica, which cannot
 * render a single character of either. The dashboard already prints Tamil every day —
 * bills, purchase lists, packing lists — through the browser's own print dialog, so
 * this sheet is printed the same way and comes out looking like the rest of them.
 *
 * The names themselves come from the SERVER, out of the Local Name field on each
 * product. Nothing here reads a spreadsheet.
 *
 * The merge rule is in lib/goods-transfer-loading-list.ts, deliberately apart from
 * all of this, so it can be run over real data without a browser.
 */

import {
    mergeLoadingList,
    mergeSummary,
    type LoadingListRow,
    type MergedItem,
} from '@/lib/goods-transfer-loading-list';
import { localNameForChannel } from '@/lib/product-master-channels';
import type { TransferLoadingList } from '@/types/goods-transfer';

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
}

/**
 * A base figure read back in the unit the godown works in.
 *
 * Grams become kilograms, millilitres become litres, and anything counted stays a
 * count — including a POOLED count, which is what Amla and Lemon are. Never two of
 * those added together; mergeLoadingList keys them apart so they cannot be.
 */
function quantityText(item: MergedItem, quantity: number): string {
    switch (item.measure) {
        case 'weight':
            return `${(quantity / 1000).toFixed(3)} kg`;
        case 'volume':
            return `${(quantity / 1000).toFixed(3)} L`;
        default:
            return `${quantity} pcs`;
    }
}

/**
 * Which script the names are printed in — Malayalam where a branch keeps its names
 * that way, Tamil otherwise.
 *
 * Only decides the FONT, never the matching. A sheet spanning branches that write in
 * different scripts falls back to the Tamil stack, which still has a Latin fallback
 * behind it, so nothing is ever rendered as empty boxes.
 */
function scriptClassFor(branchCodes: string[]): 'tamil' | 'malayalam' {
    const scripts = new Set(branchCodes.map((code) => localNameForChannel(code).script));
    return scripts.size === 1 ? [...scripts][0] : 'tamil';
}

/**
 * The dates the sheet covers, shown in its heading.
 *
 * Both blank when the caller named the transfers outright — there is no window to
 * report, and printing "any date to any date" would say less than nothing.
 */
export interface LoadingListPeriod {
    from: string;
    to: string;
}

/**
 * Which name heads each line on the sheet.
 *
 * 'tamil' is the Vendure Local Name — Product/ProductVariant.customFields.localName,
 * the field the Dashboard's Local Name box writes to. It is the name a picker in the
 * godown reads, and on the Kerala catalogue it is the Malayalam one; the option is
 * named for the script the great majority of it is written in.
 *
 * 'manglish' is the product's OWN name, as the catalogue spells it in Latin letters —
 * "Nendhram Pazham 5(nos)", "Mathanga (cut) 250gm". For the Kerala branch that name
 * is Malayalam written in English letters, which is what "Manglish" means here and
 * what a picker who does not read the script needs instead.
 *
 * It is a DISPLAY choice only. Both names are already on every line, so switching
 * costs no second request — and, crucially, the merge is untouched: quantities are
 * added together on the Local Name whichever name is printed. Matching on the Latin
 * name instead would split a product whose two branches spell it differently, which
 * is the exact problem the Local Name exists to solve.
 */
export type LoadingListNames = 'tamil' | 'manglish';

export interface LoadingListOptions {
    /**
     * One page per branch, each merged on its own, instead of one sheet across all
     * of them. "Separately" — the same rule applied within a branch rather than
     * across the run, so two transfers to Idukki still add up but nothing from
     * Coimbatore joins them. One print job either way.
     */
    perBranch?: boolean;
    /** Which name the printed column carries. Defaults to the Local Name. */
    names?: LoadingListNames;
}

/** What the sheet is called, from the side it is read on. */
function titleFor(direction: TransferLoadingList['direction']): string {
    return direction === 'IN' ? 'INCOMING GOODS' : 'LOADING LIST';
}

/** "Madurai → Idukki, Salem" when sending; "Idukki ← Madurai, Salem" when receiving. */
function routeLine(list: TransferLoadingList, branchCodes: string[]): string {
    const me = escapeHtml(list.channelCode);
    const them = escapeHtml(branchCodes.join(', '));
    return list.direction === 'IN' ? `${me} &larr; ${them}` : `${me} &rarr; ${them}`;
}

/**
 * The sheet itself.
 *
 * One row per product, a column per branch, and the total the godown weighs out. The
 * per-branch columns are the whole point of the merge being visible rather than
 * hidden: someone questioning a total can see the figures it came from without going
 * back to the transfers.
 */
export function buildLoadingListHtml(
    list: TransferLoadingList,
    period: LoadingListPeriod,
    options: LoadingListOptions = {},
): string {
    const rows: LoadingListRow[] = list.rows;
    const allBranches = [...new Set(rows.map((r) => r.branchCode))].sort((a, b) =>
        a.localeCompare(b),
    );
    const script = scriptClassFor(allBranches);
    const names: LoadingListNames = options.names ?? 'tamil';
    const printedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    /*
      Either one sheet over everything, or one per branch. Each sheet is merged on its
      own, so the per-branch pages never add across branches — that is the whole
      difference between the two.
    */
    const groups: Array<{ heading: string | null; rows: LoadingListRow[] }> = options.perBranch
        ? allBranches.map((code) => ({
              heading: code,
              rows: rows.filter((r) => r.branchCode === code),
          }))
        : [{ heading: null, rows }];

    const sheet = (group: { heading: string | null; rows: LoadingListRow[] }, last: boolean) => {
        const items = mergeLoadingList(group.rows);
        const summary = mergeSummary(items);
        const branchCodes = [...new Set(group.rows.map((r) => r.branchCode))].sort((a, b) =>
            a.localeCompare(b),
        );
        const transferCount = new Set(group.rows.map((r) => r.transferNumber)).size;
        // A single-branch page has nothing to split across columns.
        const columns = branchCodes.length > 1 ? branchCodes : [];

        const head = `
        <tr>
          <th class="th no screen-only">#</th>
          <th class="th">${names === 'manglish' ? 'PRODUCT' : 'LOCAL NAME'}</th>
          <th class="th screen-only">${names === 'manglish' ? 'LOCAL NAME' : 'PRODUCT'}</th>
          ${columns.map((code) => `<th class="th qty screen-only">${escapeHtml(code)}</th>`).join('')}
          <th class="th qty total">${columns.length ? 'TOTAL' : 'QTY'}</th>
        </tr>`;

        const body = items
            .map((item, index) => {
                const share = (code: string) => {
                    const found = item.shares.find((s) => s.branchCode === code);
                    return found ? quantityText(item, found.quantity) : '&mdash;';
                };
                /*
                  The two names a line can be headed by. The Latin one is always
                  there — it is snapshotted onto the transfer line when the product
                  is added — so only the Local Name can be missing.
                */
                const latin = escapeHtml(item.productNames.join(' / '));
                const local = item.localName
                    ? `<span class="${script}">${escapeHtml(item.localName)}</span>`
                    : '<span>—</span>';
                /*
                  Worth seeing wherever the Local Name is shown, and true of the MERGE
                  rather than of the display: this line was matched by English name,
                  so a second branch spelling it differently sits on its own row.
                */
                const flag = item.matchedOnEnglishName
                    ? '<span class="flag">no Local Name set — matched by English name</span>'
                    : '';
                /*
                  A row with no local name prints its Latin name in the leading column.
                  On screen the other column is beside it and a dash is honest; on
                  paper that column is gone, and "— · 8.000 kg" names nothing anyone
                  can pick. Nothing to rescue in Manglish — that name is never absent.
                */
                const leadCell =
                    names === 'manglish'
                        ? latin
                        : item.localName
                          ? local
                          : `<span class="screen-only">—</span><span class="print-only english">${latin}</span>`;
                const asideCell =
                    names === 'manglish'
                        ? `<td class="td screen-only">${local}${flag}</td>`
                        : `<td class="td english screen-only">${latin}${flag}</td>`;
                return `
        <tr${item.matchedOnEnglishName ? ' class="unnamed"' : ''}>
          <td class="td no screen-only">${index + 1}</td>
          <td class="td local">${leadCell}</td>
          ${asideCell}
          ${columns.map((code) => `<td class="td qty screen-only">${share(code)}</td>`).join('')}
          <td class="td qty total">${quantityText(item, item.total)}</td>
        </tr>`;
            })
            .join('');

        return `
  <section class="sheet${last ? '' : ' break'}">
    <h1>${titleFor(list.direction)}${group.heading ? ` &mdash; ${escapeHtml(group.heading)}` : ''}</h1>
    <div class="sub">
      ${routeLine(list, branchCodes)}
      ${period.from || period.to ? `&nbsp;·&nbsp; ${escapeHtml(period.from || 'any date')} to ${escapeHtml(period.to || 'any date')}` : ''}
    </div>
    <div class="note">
      ${transferCount} transfer${transferCount === 1 ? '' : 's'} &nbsp;·&nbsp;
      ${group.rows.length} line${group.rows.length === 1 ? '' : 's'} merged into ${summary.products}
      product${summary.products === 1 ? '' : 's'}
      ${columns.length ? `<span class="screen-only">&nbsp;·&nbsp; ${summary.shared} shared by more than one branch</span>` : ''}
      ${summary.unnamed ? `<span class="screen-only">&nbsp;·&nbsp; ${summary.unnamed} with no Local Name set</span>` : ''}
      &nbsp;·&nbsp; printed ${escapeHtml(printedAt)}
    </div>
    <table>
      <thead>${head}</thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
    };

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${titleFor(list.direction)} — ${escapeHtml(list.channelCode)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body {
    font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal",
                 "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika",
                 "Nirmala UI", sans-serif;
    color: #000; margin: 0; font-size: 10pt; background: #fff;
  }
  .tamil { font-family: "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", Arial, sans-serif; }
  .malayalam { font-family: "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", Arial, sans-serif; }
  .page { max-width: 1100px; margin: 0 auto; padding: 16px 20px 40px; }
  h1 { font-size: 15pt; margin: 0 0 2mm; text-align: center; letter-spacing: .5px; }
  .sub { text-align: center; font-size: 9pt; color: #444; margin-bottom: 1mm; }
  .note { text-align: center; font-size: 8.5pt; color: #666; margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; }
  .th, .td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
  .th { background: #eeeeec; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px; text-align: left; }
  .no { width: 7mm; text-align: right; }
  .qty { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total { font-weight: bold; }
  .td.local { font-size: 12pt; font-weight: bold; }
  .english { font-size: 9pt; color: #333; }
  .td.local .english { font-size: 10pt; }
  .flag { display: block; font-size: 7.5pt; color: #8a5a00; }
  .unnamed .td { background: #fffaf0; }
  .foot { padding-top: 4mm; font-size: 8.5pt; color: #444; }
  .sheet.break { margin-bottom: 8mm; }
  /* Repeat the head on every sheet — a page found on its own still has to read. */
  thead { display: table-header-group; }

  /*
    The toolbar is the one thing on screen that is not on paper. It stays put while
    a long list scrolls, because the print button is the reason the page is open.
  */
  .bar {
    position: sticky; top: 0; z-index: 1; display: flex; gap: 10px; align-items: center;
    justify-content: space-between; padding: 10px 20px; background: #1a1a2e; color: #e8e8f0;
    font: 13px/1.4 system-ui, sans-serif;
  }
  .bar .hint { color: #a0a0b8; }
  .bar button {
    cursor: pointer; border: 1px solid rgba(99,102,241,0.5); background: rgba(99,102,241,0.2);
    color: #c7d2fe; font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px;
  }
  .bar button:hover { background: rgba(99,102,241,0.3); }
  .print-only { display: none; }

  @media print {
    .bar, .screen-only { display: none !important; }
    .print-only { display: inline; }
    .page { max-width: none; padding: 0; }
    .unnamed .td { background: none; }
    .sheet.break { break-after: page; page-break-after: always; margin: 0; }
    /* Two columns on paper: what it is, and how much of it. */
    .td.local { width: 70%; }
  }
</style>
</head>
<body>
  <div class="bar">
    <span class="hint">On screen: every branch's share. On paper and in the PDF: ${
        names === 'manglish' ? 'product name' : 'local name'
    } and total only.</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="page">
  ${groups.map((group, i) => sheet(group, i === groups.length - 1)).join('')}
  <div class="foot">
    Quantities are added together only where the Local Name matches exactly${
        names === 'manglish' ? ', whichever name is printed above' : ''
    }.
    Weighed and counted goods are never added to each other.
  </div>
  </div>
</body>
</html>`;
}
