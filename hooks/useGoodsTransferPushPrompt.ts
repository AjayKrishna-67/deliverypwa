'use client';

/**
 * Asks the browser for notification permission once, on arrival in the Goods
 * Transfer section.
 *
 * There is no switch for this in the sidebar. Turning notifications on is not a
 * preference someone came here to manage — it is a question with two answers, and
 * the browser already owns the dialog for asking it. Once answered the answer
 * sticks: the browser remembers it per site, and the place to change it is the
 * browser's own site settings, not a control this app would have to keep in step
 * with them.
 *
 * Asked only when the permission is still unanswered. A refusal is never asked
 * again — nagging is how a site gets blocked for good — and a grant is not re-asked
 * either, though the subscription is quietly re-established if the browser has
 * dropped it (clearing site data does exactly that).
 *
 * Scoped to this section deliberately. In the app this was ported from, Goods
 * Transfer was the whole application, so asking on arrival meant asking once. Here
 * it is one section among several, and someone who only ever opens Orders or
 * Reports should never see this dialog.
 */

import { useEffect } from 'react';

import { enablePush, pushActive, pushState } from '@/lib/goods-transfer-push';

/**
 * Whether this browser has already been shown the dialog.
 *
 * Remembered because DISMISSING it is not an answer: the permission stays
 * "default", so the next screen asked again — and every screen in this dashboard
 * mounts its own layout, so on a phone that meant a prompt on Orders, on Reports,
 * on every page. Chrome treats repeated prompting as abuse and eventually blocks
 * the site outright, which would take push away for good.
 */
const ASKED_KEY = 'gt.pushAsked';

function alreadyAsked(): boolean {
    try {
        return localStorage.getItem(ASKED_KEY) === '1';
    } catch {
        // Storage unavailable (private mode). Better to ask once more than to
        // never ask at all.
        return false;
    }
}

function rememberAsked(): void {
    try {
        localStorage.setItem(ASKED_KEY, '1');
    } catch {
        /* As above. */
    }
}

export function useGoodsTransferPushPrompt(active: boolean): void {
    useEffect(() => {
        if (!active) {
            return;
        }
        const state = pushState();
        if (state === 'unsupported' || state === 'unconfigured' || state === 'denied') {
            return;
        }

        let cancelled = false;

        void (async () => {
            // Already granted: the permission survived, but the subscription may not
            // have. Re-subscribing is silent and costs one request.
            if (state === 'granted') {
                const alive = await pushActive();
                if (!cancelled && !alive) {
                    await enablePush().catch(() => undefined);
                }
                return;
            }

            // Still unanswered — and this is the ONE time it is asked.
            if (!cancelled && !alreadyAsked()) {
                // Recorded BEFORE the dialog, not after. Dismissing leaves the
                // permission exactly as it was, so waiting for an answer that never
                // comes would ask again on the next screen.
                rememberAsked();
                await enablePush().catch(() => undefined);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [active]);
}
