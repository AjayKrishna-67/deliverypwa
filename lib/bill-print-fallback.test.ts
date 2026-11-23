import { describe, expect, test } from 'bun:test';
import { isMissingCouponLineField } from '@/services/bill-print.service';

describe('isMissingCouponLineField', () => {
    test('spots an older backend rejecting the new fields (HTTP 400 body)', () => {
        const err = new Error(
            'Vendure API error: 400 Bad Request — {"errors":[{"message":"Cannot query field \\"discountedTotal\\" on type \\"BillPrintReportRow\\".",',
        );
        expect(isMissingCouponLineField(err)).toBe(true);
    });

    test('spots it in a GraphQL error entry too', () => {
        expect(isMissingCouponLineField({ message: 'Cannot query field "isFree" on type "BillPrintReportRow".' })).toBe(true);
    });

    test('leaves every other error alone', () => {
        expect(isMissingCouponLineField(new Error('Vendure API error: 403 Forbidden'))).toBe(false);
        expect(isMissingCouponLineField({ message: 'Cannot query field "foo" on type "Order".' })).toBe(false);
        expect(isMissingCouponLineField(null)).toBe(false);
    });
});
