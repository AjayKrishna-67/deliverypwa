/**
 * SuperAdmin-only price-change audit log. Sent with the default (master)
 * channel token like the rest of the price-matrix ops; the backend gates on
 * the SuperAdmin permission, not the channel.
 */
export const PRICE_CHANGE_HISTORY_QUERY = `
  query PriceChangeHistory($options: PriceChangeHistoryOptions) {
    priceChangeHistory(options: $options) {
      totalItems
      items {
        id
        createdAt
        variantName
        channelName
        oldPrice
        newPrice
        currencyCode
        adminName
      }
    }
  }
`;

// Per-update order-sync fan-out (variants, affected orders, synced-now, queued)
// plus the live pending-in-queue count. SuperAdmin-gated on the backend.
export const PRICE_SYNC_BATCHES_QUERY = `
  query PriceSyncBatches($options: PriceSyncBatchOptions) {
    priceSyncBatches(options: $options) {
      totalItems
      pendingInQueue
      items {
        id
        createdAt
        channelCode
        variantCount
        affectedOrders
        syncedNow
        queuedCount
      }
    }
  }
`;
