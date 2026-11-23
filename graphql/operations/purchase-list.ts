/**
 * Purchase List report (ReportsPlugin — ViewBusinessReports or
 * ViewDailyInvoiceReport).
 *
 * Built by the backend from the catalogue rather than a spreadsheet:
 *   label      Product/Variant localName, English name as a rescue
 *   ordNo      FacetValue.purchaseOrdNo (lowest on the product)
 *   totalQty   Σ option measurement × ordered qty — kg / l / Pcs by unitKind
 * Unpaginated by design: a truncated purchase list under-orders food.
 */
export const PURCHASE_LIST_REPORT_QUERY = `
  query PurchaseListReport($input: PurchaseListReportInput!) {
    purchaseListReport(input: $input) {
      rows {
        ordNo
        label
        productId
        variantId
        scope
        totalQty
        unitKind
        unitLabel
        variantCount
        incomplete
      }
      orderCount
      lineCount
      incompleteCount
    }
  }
`;
