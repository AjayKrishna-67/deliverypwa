'use client';

/**
 * What every Goods Transfer screen sits inside.
 *
 * Mounted by app/goods-transfer/layout.tsx, which means ONCE for the whole section
 * rather than once per page. That is not a detail: when each page rendered its own
 * copy, moving between the list and a transfer tore the shell down and built it
 * again, and with it the alert poll and the branch resolution — so every navigation
 * cost a fresh round of requests for things that had not changed. A layout persists
 * across the routes beneath it, so those happen once.
 *
 * Three things live here rather than in a page, because all three outlast any one
 * page:
 *
 *   THE GATE — whether this section is offered at all, and what the person may do
 *   on the branch they are currently acting as. Permissions are per branch, so
 *   switching branch in the sidebar changes the answer.
 *
 *   THE ALERTS — what another branch has just done should reach you wherever you
 *   are standing, not only while the list happens to be open.
 *
 *   THE TOASTER — sonner is already a dependency of this project but was never
 *   mounted. Mounting it HERE rather than in app/layout.tsx keeps it scoped to
 *   these screens: no existing page gains a toast host it did not ask for.
 *
 * Pages read what they need from useGoodsTransfer(). A context rather than props,
 * because a layout hands its children through opaquely and cannot pass them
 * anything.
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import type { SidebarChannel } from '@/components/layout/Sidebar';
import { NoAccessNotice } from '@/components/goods-transfer/notices';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
    markAlertsFetched,
    readAlertMarker,
    writeAlertMarker,
} from '@/lib/goods-transfer-alert-marker';
import { canSeeGoodsTransfer, permissionsFor, type Can } from '@/lib/goods-transfer-permissions';
import { useAuth } from '@/providers/AuthProvider';
import { fetchTransferChannels } from '@/services/goods-transfer.service';
import type { Alert, TransferChannel } from '@/types/goods-transfer';

export interface GoodsTransferContextValue {
    /** The branch being acted as. Every read and write carries it. */
    channelToken: string;
    channelId: string;
    channelCode: string;
    /** What this person may do on THAT branch. */
    can: Can;
    /**
     * Every branch, read ONCE for the section.
     *
     * The list needs them to turn channel ids into names and the entry screen needs
     * them for Ship-To, and both used to ask on every mount — so walking from the
     * list to a new transfer and back fetched the same unchanging list three times.
     * It is read here, where nothing unmounts until the section is left.
     */
    branches: TransferChannel[];
    /**
     * For a screen whose own read returns alerts: hand them here to be shown, and
     * send `alertsAfterId()` with that read. Doing both is what lets the shell stop
     * polling for the same thing — see the comment on `pollHere`.
     */
    reportAlerts: (alerts: Alert[]) => void;
    alertsAfterId: () => string | null;
}

const GoodsTransferContext = createContext<GoodsTransferContextValue | null>(null);

export function useGoodsTransfer(): GoodsTransferContextValue {
    const value = useContext(GoodsTransferContext);
    if (!value) {
        throw new Error('useGoodsTransfer must be used inside the Goods Transfer layout');
    }
    return value;
}

export function GoodsTransferShell({ children }: { children: ReactNode }) {
    const { isLoading: authLoading, isAuthenticated } = useRequireAuth();
    const { currentUser } = useAuth();
    const router = useRouter();

    // Channel-agnostic: someone allowed to receive transfers in Idukki should still
    // see the section while standing in Madurai. The per-branch answer is decided
    // further in, where the selected branch is known.
    const allowed = canSeeGoodsTransfer(currentUser);

    useEffect(() => {
        if (!authLoading && isAuthenticated && currentUser && !allowed) {
            router.replace('/');
        }
    }, [authLoading, isAuthenticated, currentUser, allowed, router]);

    if (authLoading) {
        return <LoadingScreen />;
    }
    if (!isAuthenticated || !allowed) {
        return null;
    }

    return (
        <DashboardLayout>
            {({ channelToken, selectedChannel, channelPermissions }) => (
                <GoodsTransferSection
                    channelToken={channelToken}
                    channel={selectedChannel}
                    channelPermissions={channelPermissions}
                >
                    {children}
                </GoodsTransferSection>
            )}
        </DashboardLayout>
    );
}

/**
 * A real component rather than more of the render prop above, because the hooks
 * below cannot legally be called inside a callback — and because everything here
 * depends on the selected branch, which only exists once the layout has resolved it.
 */
function GoodsTransferSection({
    channelToken,
    channel,
    channelPermissions,
    children,
}: {
    channelToken: string | null;
    channel: SidebarChannel | null;
    channelPermissions: string[];
    children: ReactNode;
}) {
    const router = useRouter();
    const { currentUser } = useAuth();

    const can = useMemo(() => permissionsFor(channelPermissions), [channelPermissions]);
    const userId = currentUser?.id ?? null;

    // Read once per branch, then handed to whichever screen needs it. Failing is
    // survivable: the list falls back to showing ids, and Ship-To simply has nothing
    // to offer — neither is worth an error over.
    const [branches, setBranches] = useState<TransferChannel[]>([]);
    useEffect(() => {
        if (!channelToken) {
            return;
        }
        let cancelled = false;
        fetchTransferChannels(channelToken)
            .then((found) => {
                if (!cancelled) {
                    // Alphabetical, not in creation order. The API returns channels by id,
                    // which put Idukki — the branch these screens are mostly about — ninth
                    // in a dropdown that shows seven, below the fold and out of sight.
                    setBranches([...found].sort((a, b) => a.code.localeCompare(b.code)));
                }
            })
            .catch(() => {
                // Screens say what they can without it.
            });
        return () => {
            cancelled = true;
        };
    }, [channelToken]);

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

    /**
     * Alerts that arrived with a screen's OWN read, rather than with the poll.
     *
     * The marker is advanced here for the same reason it is advanced in the poll:
     * whoever showed an alert is who has to remember having shown it, otherwise it
     * arrives again on the next read.
     */
    const reportAlerts = useCallback(
        (alerts: Alert[]) => {
            // Recorded even when nothing came back: what matters to the poll is that
            // the question was asked, not that the answer had anything in it.
            markAlertsFetched();
            if (!alerts.length || !channelToken || !userId) {
                return;
            }
            for (const alert of alerts) {
                showAlert(alert);
            }
            writeAlertMarker(userId, channelToken, alerts[alerts.length - 1].id);
        },
        [showAlert, channelToken, userId],
    );

    const alertsAfterId = useCallback(
        () => (channelToken && userId ? readAlertMarker(userId, channelToken) : null),
        [channelToken, userId],
    );

    const value = useMemo<GoodsTransferContextValue | null>(
        () =>
            channelToken && channel
                ? {
                      channelToken,
                      channelId: channel.id,
                      channelCode: channel.code,
                      can,
                      branches,
                      reportAlerts,
                      alertsAfterId,
                  }
                : null,
        [channelToken, channel, can, branches, reportAlerts, alertsAfterId],
    );

    if (!value || !channel) {
        return <LoadingScreen />;
    }
    if (!can.anything) {
        return <NoAccessNotice branch={channel.code} />;
    }
    return <GoodsTransferContext.Provider value={value}>{children}</GoodsTransferContext.Provider>;
}
