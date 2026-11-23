/**
 * Catalogue lookup behind the bill-print and packing lists: the variant's
 * local-language name and the product's facet values, by SKU.
 *
 * Standard Admin API (`productVariants`, needs ReadCatalog / ReadProduct) —
 * nothing report-specific, so it works against any backend that carries the
 * `localName` and `purchaseOrdNo` custom fields.
 */
export const PRODUCT_VARIANTS_BY_SKU_QUERY = `
  query ProductVariantsBySku($skus: [String!]!, $take: Int!) {
    productVariants(options: { filter: { sku: { in: $skus } }, take: $take }) {
      items {
        id
        sku
        name
        customFields {
          localName
        }
        product {
          id
          name
          customFields {
            localName
          }
          facetValues {
            id
            name
            customFields {
              purchaseOrdNo
            }
          }
        }
      }
    }
  }
`;
