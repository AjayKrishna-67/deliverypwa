'use client';

/**
 * One transfer.
 *
 * `params` arrives as a promise in this version of Next, so it is unwrapped with
 * React's `use` — the client-component equivalent of awaiting it in a server one.
 */

import { use } from 'react';

import { useGoodsTransfer } from '@/components/goods-transfer/GoodsTransferShell';
import { TransferDetailView } from '@/components/goods-transfer/TransferDetailView';

export default function GoodsTransferDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    const { channelToken, channelId, branches, can } = useGoodsTransfer();

    return (
        <TransferDetailView
            id={id}
            channelToken={channelToken}
            channelId={channelId}
            branches={branches}
            can={can}
        />
    );
}
