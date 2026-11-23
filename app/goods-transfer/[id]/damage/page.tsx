'use client';

/**
 * Reporting damage against one transfer.
 *
 * A route rather than a mode on the detail screen: the form is long, it holds
 * unsaved files, and giving it its own address means the browser's Back button
 * means "abandon this claim" without any of it having to be modelled as state.
 */

import { use } from 'react';

import { useGoodsTransfer } from '@/components/goods-transfer/GoodsTransferShell';
import { RaiseDamageForm } from '@/components/goods-transfer/RaiseDamageForm';

export default function RaiseDamagePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { channelToken, channelId, channelCode, can } = useGoodsTransfer();

    return (
        <RaiseDamageForm
            id={id}
            channelToken={channelToken}
            channelId={channelId}
            channelCode={channelCode}
            can={can}
        />
    );
}
