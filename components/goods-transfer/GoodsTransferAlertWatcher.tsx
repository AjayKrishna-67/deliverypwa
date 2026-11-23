'use client';

/**
 * Goods Transfer alerts and push, for the whole dashboard.
 *
 * Mounted by DashboardLayout, which every signed-in screen renders — so a branch
 * manager is told what the other branch did whether they are looking at Orders,
 * Reports or nothing in particular. It used to live inside the Goods Transfer
 * section, which meant alerts only arrived while that section was open, and — worse
 * — that someone who never opened it never subscribed to push at all, so nothing
 * could reach them when the app was closed either. Signing in is now enough.
 *
 * Does nothing for anyone without Goods Transfer permission, which on a server
 * without the plugin is everybody: the permissions it checks are declared by that
 * plugin, so no role can hold them. Delivery partners are unaffected.
 *
 * Also where sonner's Toaster is mounted. It is a dependency this project already
 * had but never used; mounting it here rather than in app/layout.tsx keeps it to
 * signed-in screens, and it draws nothing until something calls toast().
 */

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Toaster, toast } from 'sonner';
import { useTheme } from 'next-themes';

import { useGoodsTransferAlerts } from '@/hooks/useGoodsTransferAlerts';
import { useGoodsTransferPushPrompt } from '@/hooks/useGoodsTransferPushPrompt';
import { canSeeGoodsTransfer } from '@/lib/goods-transfer-permissions';
import { useAuth } from '@/providers/AuthProvider';
import type { Alert } from '@/types/goods-transfer';

/** The one route whose own read already carries the alerts. */
const LIST_ROUTE = '/goods-transfer';

export function GoodsTransferAlertWatcher({ channelToken }: { channelToken: string | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const { currentUser, logout } = useAuth();
    const { resolvedTheme } = useTheme();

    const allowed = canSeeGoodsTransfer(currentUser);
    const userId = currentUser?.id ?? null;

    /** A toast that takes you where the alert points. */
    const showAlert = useCallback(
        (alert: Alert) => {
            const open =
                alert.refType === 'transfer' && alert.refId
                    ? () => router.push(`/goods-transfer/${alert.refId}`)
                    : alert.refType === 'expiry'
                      ? () => router.push('/goods-transfer?status=EXPIRING_SOON')
                      : undefined;

            const options = {
                description: alert.transferNumber ?? alert.productName ?? undefined,
                duration: 8000,
                ...(open ? { action: { label: 'Open', onClick: open } } : {}),
            };

            // Damage is the one kind of alert that is bad news, so it is the one kind
            // that looks different.
            if (alert.type.includes('DAMAGE')) {
                toast.warning(alert.title, options);
            } else {
                toast.info(alert.title, options);
            }
        },
        [router],
    );

    const onAuthError = useCallback(async () => {
        await logout();
        router.replace('/login');
    }, [logout, router]);

    /**
     * The transfer list runs the full version of the query this poll uses, and the
     * alerts ride on it. Polling while that screen is open would ask the server the
     * same question twice, so there the list reports what it received instead.
     */
    const pollHere = pathname !== LIST_ROUTE;

    useGoodsTransferAlerts(
        allowed ? channelToken : null,
        userId,
        showAlert,
        () => void onAuthError(),
        pollHere,
    );

    // Asked once, on the first signed-in screen — not only inside Goods Transfer.
    // Without this, someone who never opened that section never subscribed, and no
    // notification could reach them with the app closed.
    useGoodsTransferPushPrompt(Boolean(allowed && channelToken));

    return <Toaster theme={resolvedTheme === 'light' ? 'light' : 'dark'} position="top-right" closeButton />;
}
