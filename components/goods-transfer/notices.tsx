'use client';

/**
 * The three things a Goods Transfer screen can say instead of showing rows.
 *
 * Kept together because all four screens can hit all three, and a message that
 * reads differently depending on which screen you were on is a message that looks
 * like a different problem.
 */

import type { ReactNode } from 'react';

function Panel({ children }: { children: ReactNode }) {
    return (
        <div className="mx-auto my-8 max-w-xl rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
            {children}
        </div>
    );
}

function Title({ children }: { children: ReactNode }) {
    return <h3 className="mb-2 text-[1rem] font-semibold text-[var(--foreground)]">{children}</h3>;
}

function Body({ children }: { children: ReactNode }) {
    return <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

/**
 * The account is real but holds no Goods Transfer permission on THIS branch.
 *
 * Naming the branch matters — the same person may well have access on another, and
 * "no access" without saying where sends them to an administrator for nothing.
 */
export function NoAccessNotice({ branch }: { branch: string }) {
    return (
        <Panel>
            <Title>No access on {branch}</Title>
            <Body>
                This account holds no Goods Transfer permission for this branch. Pick another branch
                from the sidebar, or ask an administrator to grant one.
            </Body>
        </Panel>
    );
}

/**
 * The server this dashboard talks to has no Goods Transfer plugin.
 *
 * Only a SuperAdmin can arrive here: every other account is gated by permissions
 * that the plugin itself declares, so on a server without it, no one else can even
 * see the link. Saying so plainly is the difference between "not deployed yet" and
 * "something is broken".
 */
export function PluginMissingNotice() {
    return (
        <Panel>
            <Title>Goods Transfer is not enabled on this server</Title>
            <Body>
                The server this dashboard is connected to does not have the Goods Transfer module
                installed, so there is nothing to show. Nothing is wrong with your account — you can
                see this section because you are a SuperAdmin.
            </Body>
        </Panel>
    );
}

/**
 * The branch has Goods Transfer access, but this ACTION is not part of it.
 *
 * Separate from NoAccessNotice because it is a different sentence: not "you cannot
 * be here" but "you can be here and cannot do this one thing", which is the ordinary
 * state of most roles.
 */
export function NotAllowedNotice({ action, branch }: { action: string; branch: string }) {
    return (
        <Panel>
            <Title>Not allowed on {branch}</Title>
            <Body>
                This account cannot {action} on this branch. Pick another branch from the sidebar, or
                ask an administrator to grant the permission.
            </Body>
        </Panel>
    );
}

/** Anything else the server said. Its wording is shown as it came. */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <Panel>
            <Title>Could not load</Title>
            <Body>{message}</Body>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="mt-4 cursor-pointer rounded-lg border border-[var(--card-border)] bg-overlay/[0.06] px-4 py-2 text-[0.8125rem] font-medium text-[var(--foreground)] transition-colors hover:bg-overlay/[0.1]"
                >
                    Try again
                </button>
            )}
        </Panel>
    );
}
