/**
 * Printing a run: the driver's trip note, and the loading list.
 *
 * Both are aimed at a SELECTION — named transfers when the screen that created them
 * is asking, or a direction, some branches and a date window when the list is. The
 * server applies the same rules either way, so a sheet printed from the list on
 * Friday covers the same transfers the entry screen printed on Monday.
 *
 * THE TRIP NOTE IS A URL, NOT A FETCH. The screen knows its address before the click,
 * so window.open happens inside the gesture and what opens is the browser's own PDF
 * viewer — the same thing that opens for a single transfer's document. A fetch would
 * finish long after the click that started it, and a window opened then is blocked.
 *
 * The loading list cannot be a URL, because the sheet is assembled in the browser (it
 * is headed by Tamil and Malayalam names, which the backend's PDF engine cannot draw
 * at all). So it takes the window FIRST, tells it what is happening, and writes the
 * sheet into it when it is ready.
 */

import {
    buildLoadingListHtml,
    type LoadingListNames,
} from '@/lib/goods-transfer-loading-list-print';
import { fetchTransferLoadingList } from '@/services/goods-transfer.service';
import type { CombinedDocumentInput } from '@/types/goods-transfer';

export interface RunSelection extends CombinedDocumentInput {
    channelToken: string;
}

/**
 * Where the trip note lives. Known before the click, which is the whole point.
 *
 * Always the sender's paper, so no direction travels with it — the server reads it
 * OUT regardless.
 */
export function tripNoteUrl({ channelToken, transferIds, branchIds, from, to }: RunSelection): string {
    const params = new URLSearchParams();
    if (channelToken) {
        params.set('channel', channelToken);
    }
    if (transferIds?.length) {
        params.set('transfers', transferIds.join(','));
    }
    if (branchIds?.length) {
        params.set('branches', branchIds.join(','));
    }
    if (from) {
        params.set('from', from);
    }
    if (to) {
        params.set('to', to);
    }
    return `/api/goods-transfer/trip-note?${params.toString()}`;
}

/**
 * Build the loading list and hand it to the browser's print dialog.
 *
 * `perBranch` prints one page per branch, each merged on its own, in the same print
 * job — "separately" without a window per branch for a pop-up blocker to eat.
 *
 * `names` picks which of the two names already on every line heads the printed
 * column — the Local Name, or the product's Latin-letter one. It changes nothing
 * about what is fetched or how the lines are merged.
 *
 * Returns an error message rather than throwing: every caller is a click handler that
 * wants to put the words on the screen, and none of them wants a rejected promise.
 */
export async function openLoadingList(
    { channelToken, ...selection }: RunSelection,
    options: { perBranch?: boolean; names?: LoadingListNames } = {},
): Promise<string | null> {
    const sheet = window.open('', '_blank', 'width=1000,height=1000');
    if (!sheet) {
        return 'Could not open a print window — allow pop-ups for this site and try again.';
    }
    sheet.document.write(
        '<!doctype html><meta charset="utf-8"><title>Loading list</title>' +
            '<body style="font:14px system-ui,sans-serif;padding:2rem;color:#333">Preparing the list…</body>',
    );
    sheet.document.close();

    try {
        const list = await fetchTransferLoadingList(selection, channelToken);
        sheet.document.open();
        sheet.document.write(
            buildLoadingListHtml(
                list,
                // Named transfers have no window to report; a filtered selection does.
                selection.transferIds?.length
                    ? { from: '', to: '' }
                    : { from: selection.from ?? '', to: selection.to ?? '' },
                options,
            ),
        );
        sheet.document.close();
        sheet.focus();
        return null;
    } catch (err) {
        sheet.close();
        return err instanceof Error ? err.message : 'Could not build the list';
    }
}
