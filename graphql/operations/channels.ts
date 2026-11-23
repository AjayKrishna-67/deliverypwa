/**
 * GraphQL operations for channels.
 */

export const CHANNELS_QUERY = `
  query Channels {
    channels(options: { take: 100 }) {
      items {
        id
        code
        token
        customFields {
          type
          enabled
          invoiceGroup
        }
      }
      totalItems
    }
  }
`;
