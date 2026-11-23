/**
 * The printed Purchase List document, as HTML.
 *
 * Lifted out of the reports page so the Item Request print can be the SAME sheet
 * rather than a lookalike. Two builders would have drifted the first time a column
 * width or a font stack changed, and the branches print these side by side.
 *
 * Only two things differ between the two callers — the line above the table and the
 * date on it — so those are parameters and nothing else is. In particular the caller
 * supplies `headerDate` already formatted: the request sheet has to carry the date on
 * the machine doing the printing, and a date computed inside a builder is a date
 * nobody can point at.
 *
 * The paginator is inlined into the document because the window it opens has no
 * bundler and no imports; it measures a real page in real pixels, which cannot be
 * done before the markup exists.
 */

export interface PurchaseListRow {
    /** Printed as-is — local name where there is one, English where there is not. */
    readonly name: string;
    /** Printed to three decimals, the same as the purchase list. */
    readonly qty: number;
}

export interface PurchaseListDocumentOptions {
    /** The line under the logo, e.g. "Purchase Product List" — the date is appended. */
    readonly title: string;
    /** Already formatted (dd-mm-yyyy), resolved by the caller's own clock. */
    readonly headerDate: string;
    readonly rows: readonly PurchaseListRow[];
    /** Absolute URL — a relative one resolves against about:blank in the print window. */
    readonly logoUrl: string;
    /**
     * Size of the number in the Qty column, when a caller wants it bigger.
     *
     * Omitted leaves the sheet exactly as it was — which is what the purchase list
     * itself passes, so nothing about that print changes. It is an override rather than
     * a new default because only the transfer sheet is read at arm's length off a
     * shelf; the report is read at a desk, and the two want different type.
     */
    readonly qtyFontSize?: string;
    /**
     * The branch this sheet is about, printed beside the date as "(Idukki)".
     *
     * Requests arrive from several branches and the sheets look identical once
     * they are on a desk — the products are named in the asking branch's own
     * language, so even the words on them do not say who asked. Without this
     * somebody has to remember which pile is which.
     *
     * Omitted prints the line exactly as it always did, which is what the
     * purchase list passes: that sheet is about one branch by definition, and
     * naming it there would be answering a question nobody asked.
     */
    readonly headerBranch?: string | null;
}

function escapeHtml(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => {
        switch (c) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
            default:
                return c;
        }
    });
}

/** Today as dd-mm-yyyy on the machine calling it. */
export function browserPrintDate(now: Date = new Date()): string {
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${now.getFullYear()}`;
}

export const FLOW_PAGINATOR_SCRIPT = `
<script>
(function(){
    function paginate(){
        var src = document.getElementById('src');
        if (!src) return;
        var probe = document.createElement('div');
        probe.style.cssText = 'width:100mm;height:100mm;position:absolute;left:-9999px;top:0;visibility:hidden;';
        document.body.appendChild(probe);
        var pxPerMm = probe.offsetHeight / 100;
        document.body.removeChild(probe);
        // A .page's scrollHeight includes its 8mm top+bottom padding (16mm).
        // Cap at 294mm (297 sheet − ~3mm slack) so content never spills onto a
        // sliver page; one .page === one physical sheet.
        var MAX = pxPerMm * 294;

        var pages = [];
        function newPage(){
            var p = document.createElement('div');
            p.className = 'page';
            document.body.appendChild(p);
            pages.push(p);
            return p;
        }
        var cur = newPage();
        function fits(){ return cur.scrollHeight <= MAX; }
        function place(node){
            cur.appendChild(node);
            if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(node); }
        }

        Array.prototype.slice.call(src.children).forEach(function(node){
            if (node.tagName === 'TABLE') {
                var thead = node.querySelector('thead');
                var rows = Array.prototype.slice.call(node.querySelectorAll('tbody > tr'));
                var cls = node.className;
                function newTbl(){
                    var t = document.createElement('table');
                    t.className = cls;
                    if (thead) t.appendChild(thead.cloneNode(true));
                    t.appendChild(document.createElement('tbody'));
                    return t;
                }
                var tbl = newTbl();
                cur.appendChild(tbl);
                if (!fits() && cur.childNodes.length > 1) { cur = newPage(); cur.appendChild(tbl); }
                var tb = tbl.querySelector('tbody');
                rows.forEach(function(r){
                    tb.appendChild(r);
                    if (!fits()) {
                        tb.removeChild(r);
                        cur = newPage();
                        tbl = newTbl();
                        cur.appendChild(tbl);
                        tb = tbl.querySelector('tbody');
                        tb.appendChild(r);
                    }
                });
            } else {
                place(node);
            }
        });

        src.remove();
        pages.forEach(function(p, i){
            var n = document.createElement('div');
            n.className = 'page-num';
            n.textContent = (i + 1) + ' / ' + pages.length;
            p.appendChild(n);
        });
    }
    window.addEventListener('load', function(){
        paginate();
        setTimeout(function(){ window.print(); }, 250);
    });
})();
</script>`;

export function buildPurchaseListDocument(options: PurchaseListDocumentOptions): string {
    const { title, headerDate, rows, logoUrl, qtyFontSize, headerBranch } = options;

    const rowsHtml = rows
        .map(
            (r) => `
            <tr>
                <td class="td tamil">${escapeHtml(r.name)}</td>
                <td class="td num"><b>${r.qty.toFixed(3)}</b></td>
            </tr>`,
        )
        .join('');

    return `<!DOCTYPE html>
<html lang="ta">
<head>
<meta charset="utf-8" />
<title>KAAIKANI</title>
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", sans-serif;
        font-size: 9.5pt;
        color: #000;
        background: #fff;
    }
    .page { width: 210mm; padding: 8mm 10mm; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-num { position: absolute; right: 10mm; bottom: 4mm; font-size: 8pt; color: #000; }
    .report-hdr { padding-bottom: 4px; border-bottom: 1.5pt solid #000; margin-bottom: 6px; }
    .brand-row { display: flex; align-items: center; justify-content: center; margin: 0; line-height: 0; }
    .brand-logo { display: block; height: 34px; width: auto; margin: 0; }
    .report-hdr .row { text-align: center; margin-top: 4px; font-size: 10pt; }
    /* Bigger than the date it follows, and bold: it answers "whose sheet is this"
       across a desk, which is the one thing the rest of the line cannot. */
    .report-hdr .branch { margin-left: 8px; font-size: 13pt; font-weight: bold; }
    table.purchase { width: 100%; border-collapse: collapse; }
    .purchase .th, .purchase .td { border: 1px solid #000; padding: 5px 6px; }
    .purchase .th { background: #fff; font-weight: bold; text-align: left; font-size: 10pt; }
    .purchase .item { width: 70%; }
    .purchase .qty { width: 30%; text-align: center; }
    .purchase .num { text-align: center; font-size: 9.5pt; }
    ${qtyFontSize ? `.purchase .num { font-size: ${qtyFontSize}; }` : ''}
    .tamil { font-family: "Noto Sans Tamil", "Latha", "Tamil MN", "Mangal", "Noto Sans Malayalam", "Manjari", "Meera", "Rachana", "Kartika", "Nirmala UI", Arial, sans-serif; font-size: 10pt; }
    /* margin: 0 on @page suppresses Chrome's default URL/title/date headers + footers. */
    @page { size: A4; margin: 0; }
    /* Force pure black-and-white output: the report content is already colourless,
       and this strips any colour from the logo/images so the printer never pulls
       the colour cartridge — even if the print dialog is left on "Colour". */
    .brand-logo, img { filter: grayscale(100%); }
    /* NOTE: do NOT put a CSS filter on html/body here. A filter on a page
       container forces the browser to rasterize the whole page to a bitmap when
       printing -- the PDF then looks identical but its text is an image, so it
       cannot be searched or selected (in every browser). The report content is
       already black-and-white and the logo is greyscaled via the rule above, so
       only the color-adjust hints are needed. */
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div id="src">
    <header class="report-hdr">
        <div class="brand-row">
            <img class="brand-logo" src="${logoUrl}" alt="KAAIKANI" />
        </div>
        <div class="row"><b>${escapeHtml(title)} on ${escapeHtml(headerDate)}</b>${
            headerBranch ? `<span class="branch">(${escapeHtml(headerBranch)})</span>` : ''
        }</div>
    </header>
    <table class="purchase flow">
        <thead>
            <tr>
                <th class="th item">Item Name</th>
                <th class="th qty">Qty&nbsp;/&nbsp;kg</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
    </table>
</div>
${FLOW_PAGINATOR_SCRIPT}
</body>
</html>`;
}
