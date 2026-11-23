import { describe, expect, test } from 'bun:test';
import {
    gstTaxSplit,
    gstTaxSummary,
    invoiceFileTitle,
    isIntraStateDelivery,
    mergeTaggedBills,
    parseChannelIds,
    planBillFetches,
    rupeesInWords,
} from './gst-invoice';

describe('channel config (NEXT_PUBLIC_SOUTH_MITHAI_INVOICE_CHANNELS)', () => {
    test('reads a comma list of channel ids', () => {
        expect(parseChannelIds('8,9')).toEqual(['8', '9']);
        expect(parseChannelIds(' 8 , 9 ,')).toEqual(['8', '9']);
    });
    test('unset or blank means no channel uses it', () => {
        expect(parseChannelIds(undefined)).toEqual([]);
        expect(parseChannelIds(' , ')).toEqual([]);
    });
});

describe('which state the delivery is in — same rule as the South Mithai storefront', () => {
    test('the "Tamilnadu" shipping method is intra-state (CGST + SGST)', () => {
        expect(isIntraStateDelivery('Tamilnadu')).toBe(true);
        expect(isIntraStateDelivery(' tamil nadu ')).toBe(true);
    });
    test('anything else — "Outside Tamilnadu" included — is inter-state (IGST)', () => {
        expect(isIntraStateDelivery('Outside Tamilnadu')).toBe(false);
        expect(isIntraStateDelivery('International')).toBe(false);
        expect(isIntraStateDelivery(null)).toBe(false);
    });
});

describe('tax split: taxable = GST products total / 105 × 100', () => {
    const five = (amount: number) => ({ amount, taxRate: 5 });
    const exempt = (amount: number) => ({ amount, taxRate: 0 });

    test('SM-40: ₹1055 of 5% products inside Tamil Nadu', () => {
        const lines = [13000, 13000, 13000, 13000, 13000, 13500, 13500, 13500].map(five);
        expect(gstTaxSummary(lines, true)).toEqual([{ rate: 5, taxable: 100476, cgst: 2512, sgst: 2512, igst: 0 }]);
    });
    test('only the 5% products count — a 0% product stays out', () => {
        // ₹1055 bill, ₹135 of it exempt → ₹920 / 105 × 100 = 876.19
        const lines = [...[13000, 13000, 13000, 13000, 13000, 13500, 13500].map(five), exempt(13500)];
        expect(gstTaxSummary(lines, true)).toEqual([{ rate: 5, taxable: 87619, cgst: 2190, sgst: 2190, igst: 0 }]);
    });
    test('SM-37: outside Tamil Nadu the whole 5% is IGST', () => {
        expect(gstTaxSummary([five(54000), five(13000)], false)).toEqual([
            { rate: 5, taxable: 63810, cgst: 0, sgst: 0, igst: 3190 },
        ]);
    });
    test('each other rate gets its own row', () => {
        expect(gstTaxSummary([five(10500), { amount: 11200, taxRate: 12 }, exempt(5000)], true)).toEqual([
            { rate: 5, taxable: 10000, cgst: 250, sgst: 250, igst: 0 },
            { rate: 12, taxable: 10000, cgst: 600, sgst: 600, igst: 0 },
        ]);
    });
    test('a bill of only 0% products shows one 0% row with its value', () => {
        expect(gstTaxSummary([exempt(13500), exempt(6500)], true)).toEqual([
            { rate: 0, taxable: 20000, cgst: 0, sgst: 0, igst: 0 },
        ]);
    });
    test('CGST and SGST are always equal halves', () => {
        for (const amount of [10001, 13700, 99999, 54321]) {
            const row = gstTaxSplit(amount, true, 5);
            expect(row.cgst).toBe(row.sgst);
            // Within a paisa of the amount — each half is rounded on its own
            expect(Math.abs(row.taxable + row.cgst + row.sgst - amount)).toBeLessThanOrEqual(1);
        }
    });
});

describe('amount in words (Indian numbering)', () => {
    test('matches the hand-made invoices', () => {
        expect(rupeesInWords(112200)).toBe('In Rupees one thousand one hundred twenty-two only');
        expect(rupeesInWords(58900)).toBe('In Rupees five hundred eighty-nine only');
        expect(rupeesInWords(90700)).toBe('In Rupees nine hundred seven only');
        expect(rupeesInWords(111900)).toBe('In Rupees one thousand one hundred nineteen only');
    });
    test('lakhs and crores', () => {
        expect(rupeesInWords(1250000 * 100)).toBe('In Rupees twelve lakh fifty thousand only');
        expect(rupeesInWords(30005000 * 100)).toBe('In Rupees three crore five thousand only');
    });
    test('paise and zero', () => {
        expect(rupeesInWords(10050)).toBe('In Rupees one hundred and fifty paise only');
        expect(rupeesInWords(0)).toBe('In Rupees zero only');
    });
});

describe('fetching bills per channel so each bill knows its invoice layout', () => {
    const gst = ['8'];
    test('no GST channel involved: one fetch, exactly as before', () => {
        expect(planBillFetches([], '3', gst)).toEqual([{ channelIds: undefined, gstChannelId: null }]);
        expect(planBillFetches(['3', '4'], '3', gst)).toEqual([{ channelIds: ['3', '4'], gstChannelId: null }]);
    });
    test('working in the GST channel with no picker selection', () => {
        expect(planBillFetches([], '8', gst)).toEqual([{ channelIds: ['8'], gstChannelId: '8' }]);
    });
    test('a mixed selection splits the GST channel out', () => {
        expect(planBillFetches(['3', '8', '4'], '3', gst)).toEqual([
            { channelIds: ['8'], gstChannelId: '8' },
            { channelIds: ['3', '4'], gstChannelId: null },
        ]);
    });
    test('merging keeps one bill per order, tagged from its GST fetch', () => {
        const bill = (code: string) => ({ code });
        const merged = mergeTaggedBills([
            { bills: [bill('A'), bill('B')], gstChannelId: '8' },
            { bills: [bill('B'), bill('C')], gstChannelId: null },
        ]);
        expect(merged).toEqual([
            { code: 'A', gstInvoiceChannelId: '8' },
            { code: 'B', gstInvoiceChannelId: '8' },
            { code: 'C', gstInvoiceChannelId: null },
        ]);
    });
});

describe('print window title (= the saved PDF name)', () => {
    test('one invoice is named after its number, like the hand-made ones', () => {
        expect(invoiceFileTitle('south-mithai', ['SM-40|26-27'])).toBe('South_Mithai_Invoice_SM40');
    });
    test('several invoices share one name', () => {
        expect(invoiceFileTitle('south-mithai', ['SM-35|26-27', 'SM-36|26-27'])).toBe('South_Mithai_Invoices');
        expect(invoiceFileTitle(null, ['X-1'])).toBe('Tax_Invoice_X1');
    });
});
