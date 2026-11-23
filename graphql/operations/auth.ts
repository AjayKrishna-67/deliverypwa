/**
 * GraphQL operations for authentication.
 * Query and mutation strings only — no business logic.
 */

export const LOGIN_MUTATION = `
  mutation Login($username: String!, $password: String!, $rememberMe: Boolean) {
    login(username: $username, password: $password, rememberMe: $rememberMe) {
      __typename
      ... on CurrentUser {
        id
        identifier
        channels {
          id
          code
          token
          permissions
        }
      }
      ... on InvalidCredentialsError {
        errorCode
        message
      }
      ... on NativeAuthStrategyError {
        errorCode
        message
      }
    }
  }
`;

export const ME_QUERY = `
  query Me {
    me {
      id
      identifier
      channels {
        id
        code
        token
        permissions
      }
    }
  }
`;

export const ACTIVE_ADMIN_QUERY = `
  query ActiveAdministrator {
    activeAdministrator {
      id
      firstName
      lastName
      emailAddress
      customFields {
        phoneNumber
      }
    }
  }
`;

export const LOGOUT_MUTATION = `
  mutation Logout {
    logout {
      success
    }
  }
`;
