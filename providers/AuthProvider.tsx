'use client';

/**
 * Authentication context provider.
 * Manages auth state globally and exposes login/logout actions.
 */

import {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    type ReactNode,
} from 'react';
import {
    loginUser,
    fetchMe,
    fetchActiveAdmin,
    logoutUser,
} from '@/services/auth.service';
import { ACTIVE_DELIVERY_KEY, DRIVER_LAST_FIX_KEY } from '@/lib/constants';
import { clearAllOdometers } from '@/lib/odometer';
import { sendDriverHeartbeat } from '@/services/tracking.service';
import { isDeliveryPersonUser } from '@/lib/roles';
import { getSelectedChannelToken } from '@/lib/channel';
import { disablePush } from '@/lib/goods-transfer-push';
import type {
    CurrentUser,
    ActiveAdministrator,
    AuthContextType,
} from '@/types/auth';

// ─── Context ─────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Sign-out's best-effort steps must never hold the rider on the screen —
 *  a stalled request (tunnel, flaky data) or a WebView without push support
 *  otherwise leaves "Sign out" doing nothing. */
const LOGOUT_STEP_TIMEOUT_MS = 4_000;
function withTimeout(p: Promise<unknown>): Promise<unknown> {
    return Promise.race([p, new Promise((resolve) => setTimeout(resolve, LOGOUT_STEP_TIMEOUT_MS))]);
}

// ─── Provider ────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [administrator, setAdministrator] = useState<ActiveAdministrator | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const isAuthenticated = !!currentUser;
    const permissions = currentUser?.channels?.flatMap((ch) => ch.permissions as string[]) ?? [];

    // Restore session on mount
    useEffect(() => {
        async function restoreSession() {
            try {
                const user = await fetchMe();
                if (user) {
                    setCurrentUser(user);
                    const admin = await fetchActiveAdmin();
                    setAdministrator(admin);
                }
            } catch {
                // No active session — remain unauthenticated
            } finally {
                setIsLoading(false);
            }
        }
        restoreSession();
    }, []);

    const login = useCallback(async (username: string, password: string) => {
        const result = await loginUser(username, password);
        if (result.success) {
            setCurrentUser(result.user);
            const admin = await fetchActiveAdmin();
            setAdministrator(admin);
            return { success: true };
        }
        return { success: false, error: result.error };
    }, []);

    const logout = useCallback(async () => {
        // Final gpsOn:false heartbeat BEFORE the session dies — flips the
        // fleet page to Inactive instantly instead of waiting out the
        // 60 s silence threshold. Best-effort; never blocks logout.
        if (isDeliveryPersonUser(currentUser)) {
            await withTimeout(
                sendDriverHeartbeat(
                    { gpsOn: false },
                    getSelectedChannelToken(currentUser) ?? undefined,
                ),
            );
        }
        /*
          Hand back this browser's push subscription BEFORE the session ends.

          A subscription is stored against whoever was signed in when the browser
          allowed notifications, and it does not follow a sign-out on its own. On a
          shared device that means the next person to sign in keeps receiving the
          last person's notifications — a leak, not an inconvenience.

          It goes first because releasing it is a write, and a write needs the
          session that is about to be thrown away. Failure is swallowed: nobody
          should be held signed in because a push service was slow, and the server
          drops an address of its own accord once it answers "gone".

          Does nothing at all when this browser never subscribed, which is every
          account without Goods Transfer permission.
        */
        try {
            await withTimeout(disablePush());
        } catch {
            /* Never a reason to block signing out. */
        }
        await withTimeout(logoutUser());
        // Per-user device state must not leak to the next login on a shared
        // handset: the in-progress-delivery flag, the cached GPS fix, and
        // any ride odometers
        try {
            localStorage.removeItem(ACTIVE_DELIVERY_KEY);
            localStorage.removeItem(DRIVER_LAST_FIX_KEY);
        } catch {
            // storage blocked — non-critical
        }
        clearAllOdometers();
        setCurrentUser(null);
        setAdministrator(null);
    }, [currentUser]);

    return (
        <AuthContext.Provider
            value={{
                currentUser,
                administrator,
                isAuthenticated,
                isLoading,
                permissions,
                login,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
