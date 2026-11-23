'use client';

/**
 * Building a new transfer.
 *
 * The create permission is checked here as well as by the sidebar and the list's
 * button, because a URL can be typed. The server refuses it regardless — this only
 * spares someone from filling in a form that was never going to save.
 */

import { useGoodsTransfer } from '@/components/goods-transfer/GoodsTransferShell';
import { NewTransferForm } from '@/components/goods-transfer/NewTransferForm';
import { NotAllowedNotice } from '@/components/goods-transfer/notices';

export default function NewGoodsTransferPage() {
    const { channelToken, channelId, channelCode, can, branches } = useGoodsTransfer();

    if (!can.create) {
        return <NotAllowedNotice action="start a transfer" branch={channelCode} />;
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
        <NewTransferForm
            key={channelId}
            channelToken={channelToken}
            channelId={channelId}
            branches={branches}
        />
    );
}
