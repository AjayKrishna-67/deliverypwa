'use client';

/**
 * Product request — asking another branch to send goods here.
 *
 * A route of its own rather than a mode of the new-transfer screen. The two look
 * similar and mean opposite things: one moves this branch's goods out, the other asks
 * for goods in. Sharing a screen between them is how somebody sends a load when they
 * meant to ask for one.
 *
 * Gated on `request`, which is create OR receipt — the same pair the server allows.
 * A Receiving Manager holds no create permission and is exactly who runs short, so
 * gating this on create would shut out the people it is for.
 */

import { useGoodsTransfer } from '@/components/goods-transfer/GoodsTransferShell';
import { NotAllowedNotice } from '@/components/goods-transfer/notices';
import { ProductRequestForm } from '@/components/goods-transfer/ProductRequestForm';

export default function ProductRequestPage() {
    const { channelToken, channelId, channelCode, branches, can } = useGoodsTransfer();

    if (!can.request) {
        return <NotAllowedNotice action="request products" branch={channelCode} />;
    }

    return (
        /*
          Keyed on the branch so a switch starts a clean form.

          Changing branch does not remount this subtree on its own — only the
          context values change — so without the key the draft survived into a
          branch it was not written for. Its ticked branches then included one
          that had just dropped off its own list, and the rows filed under that
          branch became unreachable: counted on the picker, absent from the
          screen, and dropped in silence on save.

          The form asks first when it holds anything — see
          usePromptOnChannelSwitch — so this only ever discards work the person
          has agreed to discard.
        */
        <ProductRequestForm
            key={channelId}
            channelToken={channelToken}
            channelId={channelId}
            channelCode={channelCode}
            branches={branches}
        />
    );
}
