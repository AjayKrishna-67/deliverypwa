/**
 * Auth-related type definitions.
 * Re-exports generated types and defines app-specific auth types.
 */

import type {
    CurrentUser as GqlCurrentUser,
    CurrentUserChannel as GqlCurrentUserChannel,
    Administrator,
    AdministratorCustomFields,
} from '@/gql/generated';

// ─── Re-exports from generated schema ───────────────────────────────

export type CurrentUser = Pick<GqlCurrentUser, 'id' | 'identifier'> & {
    channels: Array<Pick<GqlCurrentUserChannel, 'id' | 'code' | 'token' | 'permissions'>>;
};

export type CurrentUserChannel = Pick<GqlCurrentUserChannel, 'id' | 'code' | 'token' | 'permissions'>;

/**
 * Subset of Administrator returned by the `activeAdministrator` query.
 * Only includes fields we actually request in our GraphQL operation.
 */
export type ActiveAdministrator = Pick<
    Administrator,
    'id' | 'firstName' | 'lastName' | 'emailAddress'
> & {
    customFields?: Pick<AdministratorCustomFields, 'phoneNumber'> | null;
};

// ─── App-specific auth types ────────────────────────────────────────

interface LoginResultCurrentUser extends CurrentUser {
    __typename: 'CurrentUser';
}

interface LoginResultError {
    __typename: 'InvalidCredentialsError' | 'NativeAuthStrategyError';
    errorCode: string;
    message: string;
}

export type LoginResult = LoginResultCurrentUser | LoginResultError;

export type LoginResponse =
    | { success: true; user: CurrentUser }
    | { success: false; error: string };

export interface AuthContextType {
    currentUser: CurrentUser | null;
    administrator: ActiveAdministrator | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    permissions: string[];
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => Promise<void>;
}
