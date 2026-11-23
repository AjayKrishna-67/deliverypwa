/**
 * Delivery report and payment-aware fulfillment queries.
 */

/** Delivery report — role-scoped:
 *  - DP: auto-scoped to own deliveries (deliveryPersonId ignored)
 *  - Admin/Accountant: all DPs overview, pass deliveryPersonId to drill down */
export const DELIVERY_REPORT_QUERY = `
  query DeliveryReport($input: DeliveryReportInput!) {
    deliveryReport(input: $input) {
      callerRole
      grandTotalDeliveries
      grandTotalCashCount
      grandTotalQrCount
      grandTotalOnlineCount
      grandTotalPaymentLinkCount
      grandTotalCashAmount
      grandTotalQrAmount
      grandTotalOnlineAmount
      grandTotalPaymentLinkAmount
      summaries {
        deliveryPersonId
        deliveryPersonName
        deliveryPersonPhone
        totalDeliveries
        cashCount
        qrCount
        onlineCount
        paymentLinkCount
        totalCashAmount
        totalQrAmount
        totalOnlineAmount
        totalPaymentLinkAmount
        fulfillments {
          orderCode
          orderTotal
          collectedAmount
          qrCashAmount
          qrAmount
          collectionNote
          paymentCollectionMethod
          deliveredAt
          customerName
        }
      }
    }
  }
`;

/** Payment-aware fulfillments for logged-in DP — includes paymentMethod, collectedAmount etc. */
export const MY_DELIVERY_FULFILLMENTS_WITH_PAYMENT_QUERY = `
  query MyDeliveryFulfillmentsWithPayment {
    myDeliveryFulfillmentsWithPayment {
      id
      state
      method
      trackingCode
      createdAt
      updatedAt
      orderCode
      orderTotal
      paymentMethod
      paymentCollectionMethod
      collectedAmount
      collectionNote
      customerName
      shippingAddress
      lines {
        orderLineId
        quantity
      }
    }
  }
`;
