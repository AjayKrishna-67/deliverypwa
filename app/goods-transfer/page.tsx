'use client';

/**
 * The Goods Transfer landing screen — the list of transfers.
 *
 * The Suspense boundary is here because TransferList reads the chosen filters from
 * the URL with useSearchParams, and Next requires a boundary above any component
 * that does. Wrapping at the page keeps that requirement in one place instead of
 * scattered through the tree.
 */

import { Suspense } from 'react';

import { useGoodsTransfer } from '@/components/goods-transfer/GoodsTransferShell';
import { TransferList } from '@/components/goods-transfer/TransferList';

export default function GoodsTransferPage() {
    return (
        <Suspense fallback={null}>
            <ListScreen />
        </Suspense>
    );
}

function ListScreen() {
    const { channelToken, channelId, channelCode, can, branches, reportAlerts, alertsAfterId } =
        useGoodsTransfer();

    return (
        <TransferList
            channelToken={channelToken}
            channelId={channelId}
            channelCode={channelCode}
            can={can}
            branches={branches}
            reportAlerts={reportAlerts}
            alertsAfterId={alertsAfterId}
        />
    );
}
