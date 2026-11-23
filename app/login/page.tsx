'use client';

/**
 * Login page — delegates to LoginForm component.
 */

import { useRequireAuth } from '@/hooks/useRequireAuth';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
    const { isLoading, isAuthenticated } = useRequireAuth({ redirectIfAuth: true });

    if (isLoading) {
        return <LoadingScreen />;
    }

    // Don't render login form if authenticated (will redirect)
    if (isAuthenticated) {
        return null;
    }

    return <LoginForm />;
}
