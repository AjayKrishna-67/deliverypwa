/**
 * Fulfillment operations for Delivery Person (DP) role.
 * Role-based admin mutations (createDeliveryFulfillment,
 * transitToOutForDelivery, transitToDelivered) are in orders.ts.
 */

/** Session-aware query — returns fulfillments assigned to the logged-in delivery person */
export const MY_DELIVERY_FULFILLMENTS_QUERY = `
  query MyDeliveryFulfillments {
    myDeliveryFulfillments {
      id
      state
      trackingCode
      method
      createdAt
      updatedAt
      lines {
        orderLine {
          id
          quantity
          productVariant {
            name
            sku
          }
          order {
            id
            code
            state
            totalWithTax
            currencyCode
            updatedAt
            customFields {
              invoiceNo
            }
            shippingAddress {
              fullName
              streetLine1
              city
              postalCode
              province
              countryCode
              phoneNumber
              customFields {
                latitude
                longitude
              }
            }
            customer {
              firstName
              lastName
              phoneNumber
            }
            payments {
              id
              method
              state
            }
          }
        }
      }
    }
  }
`;

/**
 * Order-centric list of the logged-in delivery person's assigned orders.
 * Scoped server-side (EXISTS on the DP's fulfillments) — no per-line order
 * duplication, real pagination/total. Replaces MY_DELIVERY_FULFILLMENTS_QUERY
 * for the orders list. `fulfillments { id state }` drives the delivery buttons.
 */
export const MY_DELIVERY_ORDERS_QUERY = `
  query MyDeliveryOrders($options: DeliveryOrderListOptions) {
    myDeliveryOrders(options: $options) {
      totalItems
      items {
        id
        code
        state
        totalWithTax
        currencyCode
        updatedAt
        customFields { invoiceNo }
        shippingAddress {
          fullName
          streetLine1
          city
          postalCode
          province
          countryCode
          phoneNumber
          customFields {
            latitude
            longitude
          }
        }
        customer {
          firstName
          lastName
          phoneNumber
        }
        payments {
          id
          method
          state
        }
        fulfillments {
          id
          state
        }
      }
    }
  }
`;
