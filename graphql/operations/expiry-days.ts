/**
 * Expiry Days report — product variants of the active channel with their
 * shelf life (ProductVariant.expiryDays, a Goods Transfer plugin custom field).
 *
 * `product` is left out on purpose: it resolves one query per variant, and the
 * variant name already carries the product name.
 */

export const VARIANT_EXPIRY_DAYS_QUERY = `
  query VariantExpiryDays($options: ProductVariantListOptions) {
    productVariants(options: $options) {
      totalItems
      items {
        id
        name
        sku
        enabled
        customFields {
          expiryDays
        }
      }
    }
  }
`;
