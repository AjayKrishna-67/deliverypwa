/**
 * Authentication service — pure business logic functions.
 * No React, no state, no side effects beyond API calls.
 */

import { vendureFetch } from '@/graphql/client';
import {
    LOGIN_MUTATION,
    ME_QUERY,
    ACTIVE_ADMIN_QUERY,
    LOGOUT_MUTATION,
} from '@/graphql/operations/auth';
import type {
    CurrentUser,
    ActiveAdministrator,
    LoginResult,
    LoginResponse,
} from '@/types/auth';

// ─── Service Functions ───────────────────────────────────────────────

export async function loginUser(
    username: string,
    password: string,
): Promise<LoginResponse> {
    const { data, errors } = await vendureFetch<{ login: LoginResult }>(
        LOGIN_MUTATION,
        { username, password, rememberMe: true },
    );

    if (errors?.length) {
        return { success: false, error: errors[0].message };
    }

    const result = data.login;
    if (result.__typename === 'CurrentUser') {
        return { success: true, user: result };
    }

    return { success: false, error: result.message };
}

export async function fetchMe(): Promise<CurrentUser | null> {
    try {
        const { data } = await vendureFetch<{ me: CurrentUser | null }>(ME_QUERY);
        return data.me;
    } catch {
        return null;
    }
}

export async function fetchActiveAdmin(): Promise<ActiveAdministrator | null> {
    try {
        const { data } = await vendureFetch<{ activeAdministrator: ActiveAdministrator | null }>(
            ACTIVE_ADMIN_QUERY,
        );
        return data.activeAdministrator;
    } catch {
        return null;
    }
}

export async function logoutUser(): Promise<boolean> {
    try {
        const { data } = await vendureFetch<{ logout: { success: boolean } }>(LOGOUT_MUTATION);
        return data.logout.success;
    } catch {
        return false;
    }
}
