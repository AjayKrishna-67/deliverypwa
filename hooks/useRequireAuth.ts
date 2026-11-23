'use client';

/**
 * Hook that requires authentication.
 * Redirects to /login if not authenticated.
 * Redirects to / if already authenticated (when used on login page via redirectIfAuth).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';

interface UseRequireAuthOptions {
    /** If true, redirects authenticated users away (used on login page) */
    redirectIfAuth?: boolean;
}

export function useRequireAuth(options: UseRequireAuthOptions = {}) {
    const { redirectIfAuth = false } = options;
    const router = useRouter();
    const { isLoading, isAuthenticated, administrator, currentUser } = useAuth();

    useEffect(() => {
        if (isLoading) return;

        if (redirectIfAuth && isAuthenticated) {
            router.replace('/');
        } else if (!redirectIfAuth && !isAuthenticated) {
            router.replace('/login');
        }
    }, [isLoading, isAuthenticated, redirectIfAuth, router]);

    return { isLoading, isAuthenticated, administrator, currentUser };
}
