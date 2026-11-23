/**
 * GST tax invoice — the printed layout for channels that need a proper tax
 * invoice (South Mithai first) instead of the Kaaikani delivery bill.
 *
 * Which channels use it comes from NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS,
 * a comma list of channel ids, e.g. `8,9`. Every one of them prints with the
 * South Mithai logo (public/invoice/south-mithai-logo.png).
 *
 * Prices are GST-inclusive. Only the products that carry GST are taxed: their
 * amounts are added up and taxable value = that total / 105 × 100 (for 5%).
 * A delivery inside Tamil Nadu splits the tax into CGST + SGST; anywhere else
 * it is IGST — decided by the shipping method, exactly as the South Mithai
 * storefront's own invoice does.
 *
 * All money is in paise.
 */

/** Logo key for these invoices — public/invoice/<brand>-logo.png */
const INVOICE_BRAND = 'south-mithai';

/** "8, 9" → ["8", "9"] */
export function parseChannelIds(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

// Next inlines NEXT_PUBLIC_* only where it is referenced literally like this.
export const GST_INVOICE_CHANNEL_IDS = parseChannelIds(process.env.NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS);

/** The logo key for a GST-invoice channel; null for any other channel. */
export function gstInvoiceBrand(channelId: string | null | undefined): string | null {
    return channelId != null && GST_INVOICE_CHANNEL_IDS.includes(String(channelId)) ? INVOICE_BRAND : null;
}

/** The "Tamilnadu" shipping method is intra-state; every other one ("Outside Tamilnadu", …) is not. */
export function isIntraStateDelivery(shippingMethodName: string | null | undefined): boolean {
    const name = (shippingMethodName ?? '').trim().toLowerCase();
    return name === 'tamilnadu' || name === 'tamil nadu';
}

// ─── Tax summary ─────────────────────────────────────────────────────

export interface GstTaxRow {
    /** GST rate, e.g. 5 */
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
}

/**
 * Taxable value = amount / (100 + rate) × 100 — amount / 105 × 100 at 5%.
 * Inside Tamil Nadu the tax is CGST and SGST at half the rate each (2.5% +
 * 2.5% of the taxable value); outside it is IGST at the full rate. Each tax is
 * worked from the unrounded taxable value, so CGST and SGST always come out equal.
 */
export function gstTaxSplit(amount: number, intraState: boolean, rate: number): GstTaxRow {
    const exactTaxable = (amount * 100) / (100 + rate);
    const taxable = Math.round(exactTaxable);
    if (!intraState) {
        return { rate, taxable, cgst: 0, sgst: 0, igst: Math.round((exactTaxable * rate) / 100) };
    }
    const half = Math.round((exactTaxable * rate) / 2 / 100);
    return { rate, taxable, cgst: half, sgst: half, igst: 0 };
}

/**
 * The tax table: the amounts of the products that carry GST are totalled per
 * rate (just 5% for South Mithai) and that total is split. 0% products stay
 * out of it; a bill of only 0% products gets a single 0% row with its value.
 */
export function gstTaxSummary(
    lines: Array<{ amount: number; taxRate: number }>,
    intraState: boolean,
): GstTaxRow[] {
    const byRate = new Map<number, number>();
    for (const l of lines) {
        const rate = Number(l.taxRate) || 0;
        byRate.set(rate, (byRate.get(rate) ?? 0) + (Number(l.amount) || 0));
    }
    const taxed = [...byRate.entries()].filter(([rate]) => rate > 0).sort((a, b) => a[0] - b[0]);
    if (taxed.length === 0) {
        const total = [...byRate.values()].reduce((s, v) => s + v, 0);
        return [{ rate: 0, taxable: total, cgst: 0, sgst: 0, igst: 0 }];
    }
    return taxed.map(([rate, amount]) => gstTaxSplit(amount, intraState, rate));
}

// ─── Amount in words ─────────────────────────────────────────────────

const ONES = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowHundred(n: number): string {
    if (n < 20) return ONES[n];
    const t = TENS[Math.floor(n / 10)];
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const parts: string[] = [];
    if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
    if (rest) parts.push(belowHundred(rest));
    return parts.join(' ');
}

/** Indian numbering: crore, lakh, thousand, hundred. */
function numberInWords(n: number): string {
    if (n === 0) return 'zero';
    const crore = Math.floor(n / 1e7);
    const lakh = Math.floor((n % 1e7) / 1e5);
    const thousand = Math.floor((n % 1e5) / 1e3);
    const rest = n % 1e3;
    const parts: string[] = [];
    if (crore) parts.push(`${numberInWords(crore)} crore`);
    if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
    if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
    if (rest) parts.push(belowThousand(rest));
    return parts.join(' ');
}

/** "In Rupees one thousand one hundred twenty-two only" */
export function rupeesInWords(paise: number): string {
    const total = Math.max(0, Math.round(paise));
    const rupees = Math.floor(total / 100);
    const p = total % 100;
    return `In Rupees ${numberInWords(rupees)}${p ? ` and ${belowHundred(p)} paise` : ''} only`;
}

// ─── Fetching bills per channel ──────────────────────────────────────

export interface BillFetch {
    /** Passed to billPrintReport; undefined = the active channel (unchanged default) */
    channelIds: string[] | undefined;
    /** Set when every bill of this fetch prints as that channel's GST invoice */
    gstChannelId: string | null;
}

/**
 * Bill rows don't say which channel they belong to, so a GST channel is
 * fetched on its own and its bills are tagged. When no GST channel is
 * involved this is the one fetch the reports always made.
 */
export function planBillFetches(
    selectedChannelIds: string[],
    activeChannelId: string | null,
    gstChannelIds: readonly string[] = GST_INVOICE_CHANNEL_IDS,
): BillFetch[] {
    const effective = selectedChannelIds.length > 0 ? selectedChannelIds : activeChannelId ? [activeChannelId] : [];
    const gst = effective.filter((id) => gstChannelIds.includes(id));
    if (gst.length === 0) {
        return [{ channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined, gstChannelId: null }];
    }
    const rest = effective.filter((id) => !gstChannelIds.includes(id));
    return [
        ...gst.map((id) => ({ channelIds: [id], gstChannelId: id })),
        ...(rest.length > 0 ? [{ channelIds: rest, gstChannelId: null }] : []),
    ];
}

/** One bill per order across the fetches — the GST fetch (planned first) wins a tie. */
export function mergeTaggedBills<T extends { code: string }>(
    groups: Array<{ bills: T[]; gstChannelId: string | null }>,
): Array<T & { gstInvoiceChannelId: string | null }> {
    const byCode = new Map<string, T & { gstInvoiceChannelId: string | null }>();
    for (const { bills, gstChannelId } of groups) {
        for (const bill of bills) {
            if (!byCode.has(bill.code)) byCode.set(bill.code, { ...bill, gstInvoiceChannelId: gstChannelId });
        }
    }
    return [...byCode.values()];
}

/** Print window title — the browser's default name for the saved PDF. */
export function invoiceFileTitle(brand: string | null, invoiceNos: string[]): string {
    const label = brand
        ? brand.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('_')
        : 'Tax';
    if (invoiceNos.length !== 1) return `${label}_Invoices`;
    // "SM-40|26-27" → "SM40"
    const short = invoiceNos[0].split('|')[0].replace(/[^A-Za-z0-9]/g, '');
    return `${label}_Invoice_${short}`;
}
