/**
 * The printed GST tax invoice, as HTML — one A4 sheet per order, laid out
 * like the hand-made South Mithai invoices (SM-34 … SM-40): seller header
 * with the brand logo, customer / invoice block, item table, GST summary
 * (CGST + SGST inside Tamil Nadu, IGST outside), totals, amount in words and
 * the authorised signatory.
 *
 * Which channels print this instead of the Kaaikani bill, and the maths, live
 * in lib/gst-invoice.ts. Every class is prefixed `gi-` and scoped under
 * `.gi-page`, so these sheets can share a print window with Kaaikani bills.
 */

import { computeBillFigures } from '@/lib/bill-figures';
import {
    gstInvoiceBrand,
    gstTaxSummary,
    invoiceFileTitle,
    isIntraStateDelivery,
    rupeesInWords,
    type GstTaxRow,
} from '@/lib/gst-invoice';
import type { GroupedBill } from '@/services/bill-print.service';

/** The registered seller — the same legal entity for every brand. */
const SELLER_LINES = [
    '1st FLOOR, THANGAM HOUSING-II,NO.8B,',
    'Thirumalai Naicker St, EXT, Kovil Pappakudi,',
    'Madurai-625018',
];
const SELLER_NAME = 'KAAI KANI';
const SELLER_GSTIN = '33BFHPS5919D2ZD';
const SIGNATORY_FOR = 'For KAAIKANI';

function escapeHtml(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return c;
        }
    });
}

function money(paise: number): string {
    return (paise / 100).toFixed(2);
}

/** 5 → "5", 2.5 → "2.5" */
function pct(rate: number): string {
    return String(Number(rate.toFixed(2)));
}

/** Name, phone and one-line address from the order's shipping-address JSON. */
function invoiceParty(raw: string | null | undefined): { name: string; phone: string; address: string } {
    if (!raw) return { name: '', phone: '', address: '' };
    try {
        const a = JSON.parse(raw) as Record<string, unknown>;
        const address = [a.streetLine1, a.streetLine2, a.city, a.postalCode, a.country ?? a.countryCode]
            .map((p) => (p == null ? '' : String(p).trim()))
            .filter(Boolean)
            .join(', ');
        return { name: String(a.fullName ?? ''), phone: String(a.phoneNumber ?? ''), address };
    } catch {
        return { name: '', phone: '', address: String(raw) };
    }
}

/** Taxable Value | CGST % | Amount | SGST % | Amount — or IGST % | Amount outside Tamil Nadu. One row per rate. */
function taxTable(rows: GstTaxRow[], intraState: boolean): string {
    if (!intraState) {
        return `<table class="gi-tax">
            <thead><tr><th>Taxable Value</th><th>IGST %</th><th>Amount</th></tr></thead>
            <tbody>${rows
                .map((t) => `<tr><td>${money(t.taxable)}</td><td>${pct(t.rate)}%</td><td>${money(t.igst)}</td></tr>`)
                .join('')}</tbody>
        </table>`;
    }
    return `<table class="gi-tax">
        <thead><tr><th>Taxable Value</th><th>CGST %</th><th>Amount</th><th>SGST %</th><th>Amount</th></tr></thead>
        <tbody>${rows
            .map((t) => {
                const half = `${pct(t.rate / 2)}%`;
                return `<tr><td>${money(t.taxable)}</td><td>${half}</td><td>${money(t.cgst)}</td><td>${half}</td><td>${money(t.sgst)}</td></tr>`;
            })
            .join('')}</tbody>
    </table>`;
}

/** One invoice sheet. `origin` resolves the logo and signature in the print window. */
export function buildGstInvoiceHtml(bill: GroupedBill, origin: string): string {
    const fig = computeBillFigures(bill);
    const intraState = isIntraStateDelivery(bill.deliveryTime);
    const brand = gstInvoiceBrand(bill.gstInvoiceChannelId);
    const party = invoiceParty(bill.billingAddress);
    const totalQty = bill.lines.reduce((s, l) => s + l.qty, 0);
    // Only the GST products: their total / 105 × 100, split CGST + SGST (or IGST)
    const tax = gstTaxSummary(
        bill.lines.map((l, i) => ({ amount: fig.lines[i].amount, taxRate: l.taxRate })),
        intraState,
    );

    const itemRows = bill.lines
        .map((l, i) => {
            const lf = fig.lines[i];
            return `<tr>
                <td class="gi-c">${i + 1}</td>
                <td>${escapeHtml(l.itemName)}${lf.isFree ? ' (FREE)' : ''}</td>
                <td class="gi-c">${escapeHtml(l.hsnCode ?? '')}</td>
                <td class="gi-c">${l.qty}</td>
                <td class="gi-c">${money(l.rate)}</td>
                <td class="gi-c">${pct(Number(l.taxRate) || 0)} %</td>
                <td class="gi-r">${money(lf.amount)}</td>
            </tr>`;
        })
        .join('');

    const couponLabel = fig.couponLabel !== 'Coupon Discount' ? `<div class="gi-hint">${escapeHtml(fig.couponLabel)}</div>` : '';

    return `
<section class="gi-page">
<div class="gi-frame">
    <header class="gi-head">
        ${brand ? `<img class="gi-logo" src="${origin}/invoice/${brand}-logo.png" alt="" onerror="this.remove()" />` : ''}
        <div class="gi-seller">
            <div>${SELLER_NAME}</div>
            ${SELLER_LINES.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            <div class="gi-gstno">GST No : ${SELLER_GSTIN}</div>
        </div>
    </header>

    <div class="gi-body">
        <table class="gi-meta">
            <colgroup><col style="width:67%" /><col style="width:33%" /></colgroup>
            <tbody><tr>
                <td>
                    <table class="gi-kv"><tbody>
                        <tr><th>Customer :</th><td class="gi-up">${escapeHtml(party.name)}</td></tr>
                        <tr><th>Contact No:</th><td>${escapeHtml(party.phone)}</td></tr>
                        <tr><th>Address :</th><td class="gi-up">${escapeHtml(party.address)}</td></tr>
                        <tr class="gi-gap"><th>Delivery Type :</th><td>${escapeHtml(bill.deliveryTime ?? '')}</td></tr>
                    </tbody></table>
                </td>
                <td>
                    <table class="gi-kv"><tbody>
                        <tr><th>Invoice No:</th><td>${escapeHtml(bill.invoiceNo)}</td></tr>
                        <tr><th>Invoice Date:</th><td>${escapeHtml(bill.date)}</td></tr>
                        <tr><th>Payment Status:</th><td>${bill.paymentType === 'ONLINE' ? 'Online Payment' : 'Cash on Delivery'}</td></tr>
                    </tbody></table>
                </td>
            </tr></tbody>
        </table>

        <table class="gi-items">
            <colgroup>
                <col style="width:7%" /><col style="width:33%" /><col style="width:13%" /><col style="width:9%" />
                <col style="width:12%" /><col style="width:11%" /><col style="width:15%" />
            </colgroup>
            <thead><tr>
                <th>S.No</th><th>ItemName</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Amount</th>
            </tr></thead>
            <tbody>
                ${itemRows}
                <tr class="gi-b"><td colspan="4"></td><td class="gi-c">Total Qty</td><td class="gi-c">${totalQty.toFixed(2)}</td><td></td></tr>
            </tbody>
        </table>

        <table class="gi-sum">
            <colgroup><col style="width:67%" /><col style="width:33%" /></colgroup>
            <tbody>
                <tr>
                    <td>${taxTable(tax, intraState)}</td>
                    <td>
                        <table class="gi-tot"><tbody>
                            <tr><td>Sub Total<div class="gi-hint">(Inclusive Of All Taxes)</div></td><td class="gi-r">${money(fig.subtotal)}</td></tr>
                            <tr><td>Shipping Charges</td><td class="gi-r">${money(fig.shipping)}</td></tr>
                            ${fig.couponDiscount > 0 ? `<tr><td>Coupon Discount${couponLabel}</td><td class="gi-r">-${money(fig.couponDiscount)}</td></tr>` : ''}
                            ${fig.loyaltyDiscount > 0 ? `<tr><td>Loyalty Discount</td><td class="gi-r">-${money(fig.loyaltyDiscount)}</td></tr>` : ''}
                        </tbody></table>
                    </td>
                </tr>
                <tr>
                    <td class="gi-words">
                        <div class="gi-hint">Amount Chargeable (in words)</div>
                        <div>${rupeesInWords(bill.netTotal)}</div>
                    </td>
                    <td>
                        <table class="gi-net"><tbody>
                            <tr><td>Net Total</td><td class="gi-r">${money(bill.netTotal)}</td></tr>
                        </tbody></table>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="gi-fill"></div>
    <div class="gi-sign">
        <div>${SIGNATORY_FOR}</div>
        <img class="gi-sig" src="${origin}/invoice/signature.png" alt="" onerror="this.remove()" />
        <div>Authorized Signatory</div>
    </div>
</div>
</section>`;
}

/** Scoped under .gi-page — safe to add to a document that also holds Kaaikani bills. */
export const GST_INVOICE_CSS = `
    .gi-page {
        width: 210mm; min-height: 296mm; padding: 9mm; display: flex;
        page-break-after: always; break-after: page;
        font-family: Arial, Helvetica, sans-serif; font-size: 9pt; line-height: 1.25;
        color: #000; background: #fff; box-sizing: border-box;
    }
    .gi-page:last-child { page-break-after: auto; break-after: auto; }
    .gi-page * { box-sizing: border-box; }
    /* Kaaikani bills print greyscale; this invoice keeps its brand colours */
    .gi-page img { filter: none; }
    .gi-frame { flex: 1; display: flex; flex-direction: column; border: 1px solid #000; padding: 5mm 4mm 4mm; }
    .gi-head {
        position: relative; min-height: 27mm; padding: 2.5mm 4mm; border: 1px solid #000;
        display: flex; align-items: center; justify-content: center;
    }
    .gi-logo { position: absolute; left: 3mm; top: 50%; transform: translateY(-50%); max-height: 21mm; max-width: 52mm; }
    .gi-seller { text-align: center; font-family: "Times New Roman", Times, serif; font-weight: bold; font-size: 10.5pt; line-height: 1.3; }
    .gi-gstno { margin-top: 2mm; font-size: 11pt; }
    .gi-body { margin-top: 12mm; }
    .gi-page table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .gi-meta, .gi-items, .gi-sum { border: 1px solid #000; }
    .gi-items, .gi-sum { margin-top: -1px; }
    .gi-meta > tbody > tr > td { border: 1px solid #000; padding: 1.5mm 2mm; vertical-align: top; }
    .gi-kv th { width: 27mm; padding: 0.6mm 2mm 0.6mm 0; text-align: left; vertical-align: top; white-space: nowrap; }
    .gi-kv td { padding: 0.6mm 0; font-weight: bold; vertical-align: top; }
    .gi-kv .gi-gap th, .gi-kv .gi-gap td { padding-top: 2.5mm; }
    .gi-up { text-transform: uppercase; }
    .gi-items th, .gi-items td { border: 1px solid #000; padding: 1.2mm 1.5mm; }
    .gi-items th { text-align: center; }
    .gi-c { text-align: center; }
    .gi-r { text-align: right; }
    .gi-b td { font-weight: bold; }
    .gi-sum > tbody > tr > td { border: 1px solid #000; padding: 0; vertical-align: top; }
    .gi-tax { border-style: hidden; }
    .gi-tax th, .gi-tax td { border: 1px solid #000; padding: 1.5mm 1mm; text-align: center; }
    .gi-tot td, .gi-net td { padding: 1mm 2mm; font-weight: bold; }
    .gi-tot td { font-size: 10pt; }
    .gi-tot td:first-child, .gi-net td:first-child { width: 64%; white-space: nowrap; }
    .gi-hint { font-size: 7.5pt; font-weight: bold; }
    .gi-sum > tbody > tr > td.gi-words { padding: 1.5mm 2mm; vertical-align: middle; font-weight: bold; }
    .gi-net td { font-size: 12.5pt; padding: 2mm; }
    .gi-fill { flex: 1; min-height: 10mm; }
    .gi-sign { align-self: flex-end; text-align: right; font-weight: bold; }
    .gi-sig { display: block; height: 15mm; width: auto; margin: 1mm 0 1mm auto; }
`;

/** A print window holding only GST invoices; its title is the saved PDF's name. */
export function buildGstInvoiceDocument(bills: GroupedBill[], origin: string): string {
    const title = invoiceFileTitle(
        gstInvoiceBrand(bills[0]?.gstInvoiceChannelId),
        bills.map((b) => b.invoiceNo),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
    html, body { margin: 0; padding: 0; background: #fff; }
    /* margin: 0 suppresses Chrome's URL/title/date headers and footers */
    @page { size: A4; margin: 0; }
    @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    ${GST_INVOICE_CSS}
</style>
</head>
<body>
${bills.map((b) => buildGstInvoiceHtml(b, origin)).join('\n')}
<script>
    window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 250); });
</script>
</body>
</html>`;
}
