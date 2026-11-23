/**
 * GraphQL operations for the tag-based multi-channel price matrix.
 *
 * All three operations are sent with the DEFAULT (master) channel token. Tags
 * are global, so the token no longer gates tag search; master is used because
 * every product is assigned to it (superset), so the product set resolves
 * there. Each matrix row returns only that variant's assigned channels.
 */

/**
 * Minimal channel list — only what we need to find the default channel token.
 * Deliberately does NOT select customFields (the shared CHANNELS_QUERY selects
 * a field that doesn't exist on this schema and 400s).
 */
export const CHANNEL_TOKENS_QUERY = `
  query ChannelTokens {
    channels(options: { take: 100 }) {
      items {
        id
        code
        token
      }
    }
  }
`;

export const TAG_SUGGESTIONS_QUERY = `
  query TagSuggestions($term: String) {
    tagSuggestions(term: $term) {
      id
      value
      productCount
      variantCount
    }
  }
`;

export const VARIANT_PRICE_MATRIX_QUERY = `
  query VariantPriceMatrix($tagIds: [ID!]!, $matchMode: TagMatchMode, $options: ProductListOptions) {
    variantPriceMatrix(tagIds: $tagIds, matchMode: $matchMode, options: $options) {
      totalItems
      channels {
        id
        code
        currencyCode
      }
      rows {
        variantId
        productId
        name
        sku
        cells {
          channelId
          currencyCode
          price
          assigned
        }
      }
    }
  }
`;

export const SET_VARIANT_CHANNEL_PRICES_MUTATION = `
  mutation SetVariantChannelPrices($updates: [SetVariantChannelPriceInput!]!) {
    setVariantChannelPrices(updates: $updates) {
      updatedCount
      variantIds
    }
  }
`;
