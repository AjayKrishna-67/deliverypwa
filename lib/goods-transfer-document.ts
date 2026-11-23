/**
 * The transfer document, built here and printed by the browser.
 *
 * It was fetched as a PDF the server had drawn at Confirm. That made the driver's paper
 * a thing that had to EXIST before it could be read: a transfer still being drafted had
 * no document at all, the list could only offer the button on rows carrying an asset id,
 * and the file arrived as a download on a phone rather than as something to look at.
 *
 * Printed from the screen instead, the document is always available and always current —
 * it is drawn from the lines being displayed, so an edit is on the paper the moment it is
 * on the page. The server still generates and stores its own copy; that copy is the
 * record, this is the reading.
 *
 * A faithful port of transfer-pdf.service.ts, and the resemblance is the point: the two
 * are held side by side at a loading bay. Masthead, the details block with the branches
 * on the right, then # / ITEM DESCRIPTION / SKU / QTY, on A4 in black and white.
 */

import { FLOW_PAGINATOR_SCRIPT } from '@/lib/purchase-list-document';

/** One line of the transfer, as the detail screen already holds it. */
export interface TransferDocumentLine {
    readonly productName: string;
    readonly sku: string;
    readonly isPooled: boolean;
    readonly quantityPcs: number | null;
    readonly weightGrams: number | null;
}

export interface TransferDocumentData {
    readonly transferNumber: string;
    /** ISO. Printed in the reader's own timezone, like every other date on screen. */
    readonly createdAt: string;
    readonly sourceChannelCode: string;
    readonly destinationChannelCode: string;
    readonly driverName: string | null;
    readonly driverPhone: string | null;
    readonly vehicleNumber: string | null;
    readonly lines: readonly TransferDocumentLine[];
    /** Absolute — a relative one resolves against about:blank in the print window. */
    readonly logoUrl: string;
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

/** Date and time as the branch reads it, on the machine doing the printing. */
function printDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });
}

/**
 * The measurement and its unit stay together — "10.000 kg" is one value, and reading it
 * should not mean looking in two places.
 */
function quantityText(line: TransferDocumentLine): string {
    if (line.isPooled) {
        return line.weightGrams != null ? `${(line.weightGrams / 1000).toFixed(3)} kg` : '-';
    }
    return line.quantityPcs != null ? `${line.quantityPcs} pcs` : '-';
}

export function buildTransferDocument(data: TransferDocumentData): string {
    const driverText = [data.driverName, data.driverPhone]
        .map((s) => (s && s.trim() ? s.trim() : ''))
        .filter(Boolean)
        .join(' · ');

    const rowsHtml = data.lines
        .map(
            (l, i) => `
            <tr>
                <td class="td no">${i + 1}</td>
                <td class="td item">${escapeHtml(l.productName)}</td>
                <td class="td sku">${escapeHtml(l.sku)}</td>
                <td class="td qty"><b>${escapeHtml(quantityText(l))}</b></td>
            </tr>`,
        )
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(data.transferNumber)}</title>
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
        font-family: Arial, "Segoe UI", "Noto Sans Tamil", "Latha", "Nirmala UI", sans-serif;
        font-size: 9.5pt;
        color: #000;
        background: #fff;
    }
    .page { width: 210mm; padding: 8mm 10mm; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-num { position: absolute; right: 10mm; bottom: 4mm; font-size: 8pt; color: #000; }

    .masthead { text-align: center; margin-bottom: 8px; }
    .brand-logo { display: block; height: 40px; width: auto; margin: 0 auto 4px; }
    .addr { font-size: 8.5pt; color: #444; line-height: 1.35; }

    /* Details on the left, the two branches on the right — one box, one divider. */
    .doc-block { display: flex; border: 1.1px solid #000; margin: 10px 0 12px; }
    .doc-left { width: 56%; padding: 8px 10px; border-right: 1.1px solid #000; }
    .doc-right { width: 44%; padding: 8px 10px; }
    .field { display: flex; gap: 8px; line-height: 1.6; }
    .field .label { font-weight: bold; font-size: 8pt; min-width: 74px; }
    .field .value { font-size: 8.5pt; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .ship-label { font-weight: bold; font-size: 8pt; color: #444; }
    .ship-value { font-weight: bold; font-size: 11pt; margin-bottom: 6px; }

    table.transfer { width: 100%; border-collapse: collapse; }
    .transfer .th, .transfer .td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; }
    .transfer .th { background: #f2f2f2; font-weight: bold; text-align: left; font-size: 10.5pt; }
    .transfer .no { width: 7%; text-align: center; }
    .transfer .item { width: 55%; font-size: 10.5pt; font-weight: bold; }
    .transfer .sku { width: 18%; }
    .transfer .qty { width: 20%; text-align: right; }
    .transfer .th.qty { text-align: right; }

    /* margin: 0 on @page suppresses Chrome's default URL/title/date headers + footers. */
    @page { size: A4; margin: 0; }
    /* Pure black-and-white output: the content is already colourless, and this strips
       any colour from the logo so the printer never pulls the colour cartridge. */
    .brand-logo, img { filter: grayscale(100%); }
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div id="src">
    <header class="masthead">
        <img class="brand-logo" src="${data.logoUrl}" alt="KaaiKani" />
        <div class="addr">Kovil Papakudi, Madurai-625018<br />Toll Free: 1800 309 4983</div>
    </header>

    <div class="doc-block">
        <div class="doc-left">
            <div class="field"><span class="label">TRANSFER NO:</span><span class="value">${escapeHtml(data.transferNumber)}</span></div>
            <div class="field"><span class="label">DATE:</span><span class="value">${escapeHtml(printDateTime(data.createdAt))}</span></div>
            <div class="field"><span class="label">VEHICLE:</span><span class="value">${escapeHtml(data.vehicleNumber?.trim() || '-')}</span></div>
            <div class="field"><span class="label">DRIVER:</span><span class="value">${escapeHtml(driverText || '-')}</span></div>
        </div>
        <div class="doc-right">
            <div class="ship-label">SHIP FROM</div>
            <div class="ship-value">${escapeHtml(data.sourceChannelCode)}</div>
            <div class="ship-label">SHIP TO</div>
            <div class="ship-value">${escapeHtml(data.destinationChannelCode)}</div>
        </div>
    </div>

    <table class="transfer flow">
        <thead>
            <tr>
                <th class="th no">#</th>
                <th class="th item">ITEM DESCRIPTION</th>
                <th class="th sku">SKU</th>
                <th class="th qty">QTY</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
    </table>
</div>
${FLOW_PAGINATOR_SCRIPT}
</body>
</html>`;
}

/**
 * Open the transfer document in a print window.
 *
 * `windowRef` is opened by the caller, synchronously inside the click — a window created
 * later is no longer part of the gesture and every browser blocks it. Nothing here is
 * async today, but the signature matches the request sheet's so the two are called the
 * same way.
 */
export function printTransferDocument(
    data: TransferDocumentData,
    windowRef?: Window | null,
): void {
    const w = windowRef ?? window.open('', '_blank');
    if (!w) {
        throw new Error('The print window was blocked — allow pop-ups for this site.');
    }
    w.document.open();
    w.document.write(buildTransferDocument(data));
    w.document.close();
}
