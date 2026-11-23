import { describe, expect, test } from 'bun:test';
import { computeBillFigures, type BillFiguresInput } from './bill-figures';

const line = (over: Partial<BillFiguresInput['lines'][number]> = {}) => ({
    qty: 1,
    shadowPrice: null as number | null,
    rate: 10000,
    total: 10000,
    discountedTotal: 10000,
    isFree: false,
    ...over,
});

const bill = (over: Partial<BillFiguresInput> = {}): BillFiguresInput => ({
    lines: [line()],
    shipping: 0,
    originalShipping: 0,
    netTotal: 10000,
    couponCode: null,
    discounts: [],
    ...over,
});

describe('computeBillFigures', () => {
    test('a bill without any coupon is just the lines', () => {
        const f = computeBillFigures(bill());
        expect(f.subtotal).toBe(10000);
        expect(f.couponDiscount).toBe(0);
        expect(f.lines[0]).toMatchObject({ amount: 10000, isFree: false, isDiscounted: false });
    });

    test('a coupon free product shows as a FREE line, not as a discount at the bottom', () => {
        // ONION649-style: ₹650 of shopping + free 35 onion; the server's
        // discount entry carries the 35 as the coupon's saving.
        const f = computeBillFigures(bill({
            lines: [
                line({ rate: 65000, total: 65000, discountedTotal: 65000 }),
                line({ rate: 3500, total: 3500, discountedTotal: 0, isFree: true, shadowPrice: 40 }),
            ],
            netTotal: 65000,
            couponCode: '["ONION649"]',
            discounts: [{ description: 'ONION649', code: 'ONION649', source: 'PROMOTION:12', amount: 3500 }],
        }));
        expect(f.lines[1]).toMatchObject({ amount: 0, isFree: true, isDiscounted: true, saving: 4000 });
        expect(f.subtotal).toBe(65000);
        expect(f.couponDiscount).toBe(0); // already shown on the FREE line
        expect(f.couponLabel).toBe('ONION649');
        expect(f.totalSavings).toBe(4000);
        expect(f.subtotal + f.shipping - f.couponDiscount - f.loyaltyDiscount).toBe(f.netTotal);
    });

    test('an order-level coupon is one discount line under the subtotal', () => {
        const f = computeBillFigures(bill({
            lines: [line({ rate: 50000, total: 50000, discountedTotal: 50000 })],
            netTotal: 45000,
            couponCode: '["SAVE50"]',
            discounts: [{ description: 'Flat 50 off', code: 'SAVE50', source: 'PROMOTION:3', amount: 5000 }],
        }));
        expect(f.subtotal).toBe(50000);
        expect(f.couponDiscount).toBe(5000);
        expect(f.couponLabel).toBe('SAVE50 Flat 50 off');
        expect(f.subtotal + f.shipping - f.couponDiscount - f.loyaltyDiscount).toBe(f.netTotal);
    });

    test('a product percentage coupon lowers that line and shows the saving there', () => {
        const f = computeBillFigures(bill({
            lines: [line({ qty: 2, rate: 5000, total: 10000, discountedTotal: 9000 })],
            netTotal: 9000,
            couponCode: '["VEG10"]',
            discounts: [{ description: 'VEG10', code: 'VEG10', source: 'PROMOTION:4', amount: 1000 }],
        }));
        expect(f.lines[0]).toMatchObject({ amount: 9000, unitAmount: 4500, isFree: false, isDiscounted: true, saving: 1000 });
        expect(f.couponDiscount).toBe(0);
        expect(f.totalSavings).toBe(1000);
    });

    test('loyalty points stay their own line, apart from the coupon', () => {
        const f = computeBillFigures(bill({
            lines: [line({ rate: 50000, total: 50000, discountedTotal: 50000 })],
            netTotal: 44000,
            couponCode: '["SAVE50"]',
            discounts: [
                { description: 'Flat 50 off', code: 'SAVE50', source: 'PROMOTION:3', amount: 5000 },
                { description: 'Loyalty Points Discount', code: null, source: 'SURCHARGE:9', amount: 1000 },
            ],
        }));
        expect(f.loyaltyDiscount).toBe(1000);
        expect(f.couponDiscount).toBe(5000);
        expect(f.subtotal + f.shipping - f.couponDiscount - f.loyaltyDiscount).toBe(f.netTotal);
    });

    test('free shipping from the coupon is shown on the shipping line', () => {
        const f = computeBillFigures(bill({
            lines: [line({ rate: 50000, total: 50000, discountedTotal: 50000 })],
            shipping: 0,
            originalShipping: 4000,
            netTotal: 50000,
            couponCode: '["FREESHIP"]',
            discounts: [],
        }));
        expect(f.shipping).toBe(0);
        expect(f.shippingSavings).toBe(4000);
        expect(f.couponDiscount).toBe(0);
        expect(f.totalSavings).toBe(4000);
    });

    test('rows cached before the new fields fall back to the list price', () => {
        const f = computeBillFigures(bill({
            lines: [line({ rate: 50000, total: 50000, discountedTotal: null, isFree: null })],
            netTotal: 45000,
            couponCode: '["SAVE50"]',
            discounts: [{ description: 'SAVE50', code: 'SAVE50', source: 'PROMOTION:3', amount: 5000 }],
        }));
        expect(f.lines[0]).toMatchObject({ amount: 50000, isFree: false });
        expect(f.couponDiscount).toBe(5000);
    });

    test('MRP savings are counted per line, once', () => {
        const f = computeBillFigures(bill({
            lines: [line({ qty: 2, shadowPrice: 60, rate: 5000, total: 10000, discountedTotal: 10000 })],
            netTotal: 10000,
        }));
        expect(f.lines[0].saving).toBe(2000);
        expect(f.totalSavings).toBe(2000);
    });
});
