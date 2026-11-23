'use client';

/**
 * ThemeToggle — Light / Dark / System picker for the sidebar footer.
 * Expanded sidebar: three-way segmented control.
 * Collapsed sidebar: one icon button that cycles light → dark → system.
 */

import { useSyncExternalStore, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import type { ThemeChoice } from '@/providers/ThemeProvider';

const OPTIONS: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
    {
        value: 'light',
        label: 'Light',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
        ),
    },
    {
        value: 'dark',
        label: 'Dark',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
        ),
    },
    {
        value: 'system',
        label: 'System',
        icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
        ),
    },
];

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards. The saved theme lives in
 *  localStorage, which the server cannot see — rendering the active state
 *  before this flips would mismatch the server HTML. */
function useIsClient() {
    return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const isClient = useIsClient();
    const active: ThemeChoice | null = isClient ? ((theme as ThemeChoice | undefined) ?? 'system') : null;

    if (collapsed) {
        const current = OPTIONS.find((o) => o.value === active) ?? OPTIONS[2];
        const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length];
        const label = current.value === 'system' && resolvedTheme
            ? `Theme: System (${resolvedTheme})`
            : `Theme: ${current.label}`;
        return (
            <div className="flex justify-center px-1.5 py-2.5 border-t border-[var(--card-border)]">
                <button
                    type="button"
                    onClick={() => setTheme(next.value)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-colors hover:bg-overlay/10 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    style={{ color: 'var(--text-muted)' }}
                    title={`${label} — tap for ${next.label}`}
                    aria-label={`${label}. Switch to ${next.label}`}
                >
                    {/* Icon hidden until mounted so SSR and client agree */}
                    <span className={isClient ? '' : 'invisible'}>{current.icon}</span>
                </button>
            </div>
        );
    }

    return (
        <div className="px-2 py-2.5 border-t border-[var(--card-border)]">
            <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] px-2 mb-2">
                Theme
            </p>
            {/* Toggle buttons (aria-pressed) rather than a radiogroup: a radiogroup
                promises arrow-key navigation, plain buttons are honest with Tab. */}
            <div
                role="group"
                aria-label="Colour theme"
                className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg"
                style={{ background: 'rgb(var(--overlay-rgb)/0.06)', border: '1px solid var(--card-border)' }}
            >
                {OPTIONS.map((opt) => {
                    const isActive = opt.value === active;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setTheme(opt.value)}
                            className="flex flex-col items-center gap-0.5 py-1.5 rounded-md text-[0.6875rem] font-medium cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            style={{
                                background: isActive ? 'var(--surface)' : 'transparent',
                                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                                boxShadow: isActive ? '0 1px 3px rgb(0 0 0 / 0.15)' : 'none',
                            }}
                            title={opt.value === 'system' ? 'Follow your device setting' : undefined}
                        >
                            {opt.icon}
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
