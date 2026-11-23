/**
 * Monthly product sales report query (ReportsPlugin — admin/accountant only).
 * Aggregates delivered orders by product within a date range.
 */

export const MONTHLY_PRODUCT_SALES_REPORT_QUERY = `
  query MonthlyProductSalesReport($input: MonthlyProductSalesReportInput!) {
    monthlyProductSalesReport(input: $input) {
      totalItems
      totalQuantitySold
      totalSalesAmount
      items {
        productId
        productName
        facets {
          id
          name
        }
        totalQuantitySold
        totalSalesAmount
      }
    }
  }
`;
