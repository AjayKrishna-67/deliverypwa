/**
 * GraphQL operations for the location-first stock editor.
 *
 * All operations are sent with the DEFAULT (master) channel token: stock
 * locations, products and tags are channel-scoped in Vendure and the default
 * channel contains them all, so one default-channel query surfaces every
 * product across every channel a location serves. Stock crosses the wire as an
 * integer in the variant's BASE unit (grams for kg, count for piece) — convert
 * at the UI boundary only (see lib/stock-units.ts).
 */

export const STOCK_LOCATIONS_QUERY = `
  query StockLocationsForStock {
    stockLocations(options: { take: 100 }) {
      items {
        id
        name
      }
    }
  }
`;

export const STOCK_CATALOG_TAGS_QUERY = `
  query CatalogTagsForStock {
    catalogTags {
      id
      value
    }
  }
`;

export const LOCATION_VARIANT_STOCK_QUERY = `
  query LocationVariantStock($stockLocationId: ID!, $tagIds: [ID!], $matchMode: TagMatchMode, $search: String) {
    locationVariantStock(stockLocationId: $stockLocationId, tagIds: $tagIds, matchMode: $matchMode, search: $search) {
      variantId
      productId
      sku
      name
      stockUnit
      baseUnit
      stockOnHand
      stockAllocated
    }
  }
`;

export const LOCATION_PRODUCT_POOL_STOCK_QUERY = `
  query LocationProductPoolStock($stockLocationId: ID!, $tagIds: [ID!], $matchMode: TagMatchMode, $search: String) {
    locationProductPoolStock(stockLocationId: $stockLocationId, tagIds: $tagIds, matchMode: $matchMode, search: $search) {
      productId
      name
      hasPoolHere
      stockOnHand
      stockAllocated
    }
  }
`;

export const SET_VARIANT_STOCK_ON_HAND_MUTATION = `
  mutation SetVariantStockOnHand($input: SetVariantStockInput!) {
    setVariantStockOnHand(input: $input)
  }
`;

export const SET_PRODUCT_POOL_STOCK_MUTATION = `
  mutation SetProductPoolStock($input: SetProductPoolStockInput!) {
    setProductPoolStock(input: $input)
  }
`;
