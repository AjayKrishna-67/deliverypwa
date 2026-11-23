'use client';

/**
 * A veto on changing branch, for screens holding work that belongs to the branch
 * they were started in.
 *
 * The sidebar's branch picker changes a value the whole app reads, but it does NOT
 * remount what is on screen — so a half-built product request stayed exactly as it
 * was while the branch under it changed. Its ticked branches and its typed rows then
 * referred to a branch that was no longer offered: the dropdown showed one tick while
 * the button counted two, and rows entered for the branch you had just switched TO
 * became invisible and were dropped on save.
 *
 * The screens that hold such work register a guard here. The picker asks it first
 * and only switches if it says yes, so the question is put to the person BEFORE the
 * work disappears rather than after.
 *
 * One guard at a time, deliberately. Only one screen is ever on show, and a stack
 * would mean deciding what a second, hidden screen's unsaved work is worth — a
 * question this app never has to ask.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/** Answers "may the branch change now?" — false cancels the switch. */
export type ChannelSwitchGuard = () => boolean | Promise<boolean>;

/**
 * What the dashboard layout hands down: a way to register, and nothing else.
 *
 * The layout keeps the guard in a ref of its own and reads it inside the picker's
 * click handler, so registering costs no render anywhere.
 */
export interface ChannelSwitchGuardApi {
    setGuard: (guard: ChannelSwitchGuard | null) => void;
}

export const ChannelSwitchGuardContext = createContext<ChannelSwitchGuardApi | null>(null);

/**
 * Register `guard` for as long as the calling component is mounted.
 *
 * The guard is reached through a ref rather than captured, so it always sees the
 * latest render's state without re-registering on every keystroke — re-registering
 * as rows were typed would swap the guard out between the click and the answer.
 * Writing that ref in an effect rather than during render is what React asks for,
 * and costs nothing here: the guard is only ever called from a click, which is long
 * after effects have run.
 *
 * Does nothing outside the provider, so a screen using it is not tied to being
 * rendered inside the dashboard.
 */
export function useChannelSwitchGuard(guard: ChannelSwitchGuard): void {
    const api = useContext(ChannelSwitchGuardContext);
    const latest = useRef(guard);

    useEffect(() => {
        latest.current = guard;
    });

    useEffect(() => {
        if (!api) {
            return;
        }
        api.setGuard(() => latest.current());
        return () => api.setGuard(null);
    }, [api]);
}

/**
 * A guard that asks the person, for the common shape: nothing typed means nothing to
 * ask about, and anything typed gets one question.
 *
 * `pending` is true exactly while a decision is owed — the screen renders its own
 * dialog from it and answers with `confirm()` or `cancel()`. The dialog belongs to
 * the screen rather than to this module because only the screen can say what is
 * about to be lost.
 */
export function usePromptOnChannelSwitch(hasWork: boolean): {
    pending: boolean;
    confirm: () => void;
    cancel: () => void;
} {
    const resolveRef = useRef<((ok: boolean) => void) | null>(null);
    // State, not the ref alone: the dialog has to appear, and that is a render.
    const [pending, setPending] = useState(false);

    useChannelSwitchGuard(
        useCallback(() => {
            if (!hasWork) {
                return true;
            }
            setPending(true);
            return new Promise<boolean>((resolve) => {
                resolveRef.current = resolve;
            });
        }, [hasWork]),
    );

    // A question that outlives its screen must not leave the picker awaiting a
    // promise nobody will settle.
    useEffect(
        () => () => {
            resolveRef.current?.(false);
            resolveRef.current = null;
        },
        [],
    );

    const settle = useCallback((ok: boolean) => {
        setPending(false);
        resolveRef.current?.(ok);
        resolveRef.current = null;
    }, []);

    return {
        pending,
        confirm: useCallback(() => settle(true), [settle]),
        cancel: useCallback(() => settle(false), [settle]),
    };
}
