/**
 * Delivery orders query — uses the custom role-based `deliveryOrders` query.
 * Supports server-side shippingMethodId / postalCode filtering plus standard
 * filter, sort, skip, take via DeliveryOrderListOptions.
 */
export const DELIVERY_ORDERS_QUERY = `
  query DeliveryOrders($options: DeliveryOrderListOptions) {
    deliveryOrders(options: $options) {
      totalItems
      items {
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
          postalCode
          fullName
          streetLine1
          city
          province
          countryCode
          phoneNumber
          customFields {
            area
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
`;


export const SHIPPING_METHODS_QUERY = `
  query ShippingMethods {
    shippingMethods(options: { take: 100 }) {
      items {
        id
        name
        code
      }
    }
  }
`;
/**
 * Lightweight query to get unique postal codes from delivery orders.
 * Uses the custom role-based `deliveryOrders` query.
 */
export const DELIVERY_ORDER_POSTAL_CODES_QUERY = `
  query DeliveryOrderPostalCodes($options: DeliveryOrderListOptions) {
    deliveryOrders(options: $options) {
      totalItems
      items {
        shippingAddress {
          postalCode
        }
      }
    }
  }
`;

/**
 * Standard Vendure `orders` query — used to fetch post-fulfillment orders
 * (Shipped, OutForDelivery, Delivered) which are NOT returned by `deliveryOrders`.
 * Supports server-side filter (state in), sort (updatedAt DESC), skip, take.
 */
export const ORDERS_BY_STATE_QUERY = `
  query OrdersByState($options: OrderListOptions) {
    orders(options: $options) {
      totalItems
      items {
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
          postalCode
          fullName
          streetLine1
          city
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
        fulfillments {
          id
          state
        }
        payments {
          id
          method
          state
        }
      }
    }
  }
`;

/**
 * Fetch all postal code areas — used to populate the area filter dropdown.
 * When postalCodeId is provided, returns areas for that postal code only.
 */
export const POSTAL_CODE_AREAS_QUERY = `
  query PostalCodeAreas($postalCodeId: ID) {
    postalCodeAreas(postalCodeId: $postalCodeId) {
      id
      name
      postalCode {
        id
        code
      }
    }
  }
`;

/** Full order detail — used for the order detail page */
export const ORDER_FULL_DETAIL_QUERY = `
  query OrderFullDetail($id: ID!) {
    order(id: $id) {
      id
      code
      state
      active
      totalWithTax
      subTotalWithTax
      shippingWithTax
      currencyCode
      createdAt
      updatedAt
      orderPlacedAt
      totalQuantity
      couponCodes
      customFields {
        invoiceNo
        cancellationReason
        otherInstructions
        platform
        deviceMedium
        loyaltyPointsEarned
        loyaltyPointsUsed
      }
      customer {
        id
        firstName
        lastName
        phoneNumber
        emailAddress
      }
      shippingAddress {
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        countryCode
        phoneNumber
        customFields {
          latitude
          longitude
        }
      }
      billingAddress {
        fullName
        streetLine1
        city
        province
        postalCode
        countryCode
      }
      lines {
        id
        quantity
        linePriceWithTax
        unitPriceWithTax
        productVariant {
          id
          name
          sku
        }
        featuredAsset {
          preview
        }
        fulfillmentLines {
          fulfillment {
            id
            state
          }
          quantity
        }
      }
      payments {
        id
        method
        amount
        state
        transactionId
        createdAt
        errorMessage
      }
      fulfillments {
        id
        state
        method
        trackingCode
        createdAt
        updatedAt
        lines {
          orderLineId
          quantity
        }
      }
      shippingLines {
        shippingMethod {
          id
          name
          code
        }
        priceWithTax
      }
      surcharges {
        id
        description
        sku
        priceWithTax
      }
      taxSummary {
        description
        taxRate
        taxBase
        taxTotal
      }
      history(options: { take: 50, sort: { createdAt: DESC } }) {
        items {
          id
          type
          createdAt
          isPublic
          data
          administrator {
            firstName
            lastName
          }
        }
      }
    }
  }
`;

/** Fetch a single order's payment IDs — used before settling a payment */
export const ORDER_DETAIL_QUERY = `
  query OrderDetail($id: ID!) {
    order(id: $id) {
      id
      state
      payments {
        id
        state
      }
    }
  }
`;

/** Fetch fulfillment + line details for a single order — used on-demand
 *  when the user clicks Fulfill / Out for Delivery / Delivered buttons. */
export const ORDER_FULFILLMENT_DETAIL_QUERY = `
  query OrderFulfillmentDetail($id: ID!) {
    order(id: $id) {
      id
      fulfillments {
        id
        state
      }
      lines {
        id
        quantity
        productVariant {
          name
          sku
          stockOnHand
        }
        featuredAsset {
          preview
        }
        fulfillmentLines {
          fulfillment {
            id
            state
          }
          quantity
        }
      }
    }
  }
`;

/** Settle a single payment by its ID — transitions PaymentAuthorized → PaymentSettled */
export const SETTLE_PAYMENT_MUTATION = `
  mutation SettlePayment($id: ID!) {
    settlePayment(id: $id) {
      __typename
      ... on Payment {
        id
        state
      }
      ... on ErrorResult {
        errorCode
        message
      }
    }
  }
`;

/** Fetch all delivery persons — used to populate the fulfillment dropdown */
export const GET_DELIVERY_PERSONS_QUERY = `
  query GetDeliveryPersons {
    deliveryPersons {
      id
      firstName
      lastName
      emailAddress
      phoneNumber
    }
  }
`;

/** Create a delivery fulfillment — role-based custom mutation that handles
 *  handler config + order state transition internally. */
export const CREATE_DELIVERY_FULFILLMENT_MUTATION = `
  mutation CreateDeliveryFulfillment($input: CreateDeliveryFulfillmentInput!) {
    createDeliveryFulfillment(input: $input) {
      id
      state
      method
      trackingCode
      createdAt
    }
  }
`;

/** Transition fulfillment + order to OutForDelivery — role-based custom mutation */
export const TRANSIT_TO_OUT_FOR_DELIVERY_MUTATION = `
  mutation TransitToOutForDelivery($fulfillmentId: ID!) {
    transitToOutForDelivery(fulfillmentId: $fulfillmentId) {
      id
      state
      method
      trackingCode
      updatedAt
    }
  }
`;

/** Transition fulfillment + order to Delivered — role-based custom mutation.
 *  Accepts optional paymentCollection for COD orders. */
export const TRANSIT_TO_DELIVERED_MUTATION = `
  mutation TransitToDelivered($fulfillmentId: ID!, $paymentCollection: PaymentCollectionInput) {
    transitToDelivered(fulfillmentId: $fulfillmentId, paymentCollection: $paymentCollection) {
      id
      state
    }
  }
`;

/** Generate a Razorpay QR code for COD payment collection */
export const GENERATE_DELIVERY_QR_CODE_MUTATION = `
  mutation GenerateDeliveryQrCode($input: GenerateDeliveryQrInput!) {
    generateDeliveryQrCode(input: $input) {
      qrCodeId
      imageUrl
      amount
      cashAmount
      status
      closesAt
    }
  }
`;

/** Poll QR payment status — returns 'active', 'paid', or 'closed' */
export const CHECK_DELIVERY_QR_STATUS_MUTATION = `
  mutation CheckDeliveryQrStatus($fulfillmentId: ID!) {
    checkDeliveryQrStatus(fulfillmentId: $fulfillmentId) {
      qrCodeId
      imageUrl
      amount
      cashAmount
      status
    }
  }
`;

/** Cancel/close an active QR code */
export const CLOSE_DELIVERY_QR_CODE_MUTATION = `
  mutation CloseDeliveryQrCode($fulfillmentId: ID!) {
    closeDeliveryQrCode(fulfillmentId: $fulfillmentId) {
      qrCodeId
      status
    }
  }
`;

/** Read-only lookup of existing QR code for a fulfillment */
export const DELIVERY_QR_CODE_QUERY = `
  query DeliveryQrCode($fulfillmentId: ID!) {
    deliveryQrCode(fulfillmentId: $fulfillmentId) {
      qrCodeId
      imageUrl
      amount
      cashAmount
      status
      closesAt
    }
  }
`;

/** Create a Razorpay Payment Link for remote payment collection */
export const CREATE_PAYMENT_LINK_MUTATION = `
  mutation CreateDeliveryPaymentLink($input: CreateDeliveryPaymentLinkInput!) {
    createDeliveryPaymentLink(input: $input) {
      paymentLinkId
      shortUrl
      amount
      status
      customerPhone
    }
  }
`;

/** Poll Payment Link status — returns 'created', 'paid', 'cancelled', 'expired' */
export const CHECK_PAYMENT_LINK_STATUS_MUTATION = `
  mutation CheckDeliveryPaymentLinkStatus($fulfillmentId: ID!) {
    checkDeliveryPaymentLinkStatus(fulfillmentId: $fulfillmentId) {
      paymentLinkId
      shortUrl
      amount
      status
      customerPhone
    }
  }
`;

/** Cancel an active Payment Link */
export const CANCEL_PAYMENT_LINK_MUTATION = `
  mutation CancelDeliveryPaymentLink($fulfillmentId: ID!) {
    cancelDeliveryPaymentLink(fulfillmentId: $fulfillmentId) {
      paymentLinkId
      status
    }
  }
`;
