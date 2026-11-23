/**
 * Bill print report (ReportsPlugin — admin/accountant only).
 * Returns one row per order line with bill-level info repeated;
 * caller groups by `code` to assemble bills.
 */

/** Returns the full list of order states available in Vendure (e.g.
 *  "PaymentSettled", "Shipped", "Delivered", ...). Used to populate the
 *  states multi-select on the Invoice Report. Requires ViewBusinessReports. */
export const AVAILABLE_ORDER_STATES_QUERY = `
  query AvailableOrderStates {
    availableOrderStates
  }
`;

export const BILL_PRINT_REPORT_QUERY = `
  query BillPrintReport($input: BillPrintReportInput!) {
    billPrintReport(input: $input) {
      totalItems
      items {
        id
        code
        pCode
        date
        time
        billingAddress
        itemName
        qty
        shadowPrice
        rate
        total
        subTotal
        shipping
        originalShipping
        netTotal
        hsnCode
        taxRate
        taxAmount
        priceBeforeTax
        totalTaxAmount
        deliveryTime
        cuttingInstructions
        paymentMode
        paymentMethod
        paymentMetadata
        paymentType
        adminMarkedAsPaid
        ordNo
        customerId
        rewardPointUsed
        loyaltyPointsUsed
        loyaltyPointsAvailable
        couponCode
        discounts {
          description
          code
          source
          amount
        }
        note
        orderModifyNote
        invoiceNo
        discountedTotal
        isFree
      }
    }
  }
`;

/** Same query without the coupon line fields (discountedTotal, isFree), for a
 *  backend that does not have them yet. Bills then fall back to list prices. */
export const BILL_PRINT_REPORT_QUERY_LEGACY = BILL_PRINT_REPORT_QUERY
    .replace(/\n\s*discountedTotal/, '')
    .replace(/\n\s*isFree/, '');
