/**
 * Sales report query (ReportsPlugin — admin/accountant only).
 */

/** Sales report — delivered orders within a date range, scoped to the active
 *  channel (or an explicit channelIds list). Requires `ViewBusinessReports`. */
export const SALES_REPORT_QUERY = `
  query SalesReport($input: SalesReportInput!) {
    salesReport(input: $input) {
      items {
        orderCode
        orderStatus
        invoiceNo
        orderAmount
        netAmount
        orderPlacedAt
        deliveredAt
        channelId
        channelCode
      }
      totalItems
      totalOrderAmount
      totalNetAmount
    }
  }
`;
