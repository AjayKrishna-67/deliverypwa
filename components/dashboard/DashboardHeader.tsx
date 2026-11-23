'use client';

/**
 * Dashboard header with hamburger (mobile), user info, active channel badge, logout.
 */

import type { ActiveAdministrator } from '@/types/auth';
import { VehicleSwitch } from '@/components/location/VehicleSwitch';

interface ChannelBadge {
    id: string;
    code: string;
    customFields?: { invoiceGroup?: string | null } | null;
}

interface DashboardHeaderProps {
    administrator: ActiveAdministrator | null;
    onLogout: () => void | Promise<void>;
    selectedChannel?: ChannelBadge | null;
    /** Called when the hamburger button is tapped on mobile */
    onMenuToggle?: () => void;
}

function channelDisplayName(ch: ChannelBadge): string {
    if (ch.code === '__default_channel__') return 'All Channels';
    return ch.code
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function DashboardHeader({ administrator, onLogout, selectedChannel, onMenuToggle }: DashboardHeaderProps) {
    const initials = administrator
        ? `${administrator.firstName[0]}${administrator.lastName[0]}`
        : '?';

    return (
        <header
            className="flex items-center gap-3 px-4 md:px-6 py-3.5 border-b border-[var(--card-border)] bg-[var(--card-bg)] backdrop-blur-xl shrink-0"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.875rem)' }}
        >

            {/* Hamburger — mobile only */}
            {onMenuToggle && (
                <button
                    onClick={onMenuToggle}
                    className="md:hidden flex flex-col gap-1.5 p-1.5 rounded-lg cursor-pointer transition-all hover:bg-overlay/10 shrink-0"
                    aria-label="Open menu"
                >
                    <span className="w-5 h-0.5 bg-[var(--foreground)] block rounded-full" />
                    <span className="w-5 h-0.5 bg-[var(--foreground)] block rounded-full" />
                    <span className="w-5 h-0.5 bg-[var(--foreground)] block rounded-full" />
                </button>
            )}

            {/* User info */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {initials}
                </div>
                <div className="min-w-0 hidden sm:block">
                    <h2 className="text-[0.875rem] font-semibold leading-tight truncate">
                        {administrator
                            ? `${administrator.firstName} ${administrator.lastName}`
                            : 'User'}
                    </h2>
                    <p className="text-[0.6875rem] text-[var(--text-muted)] truncate">
                        {administrator?.emailAddress ?? ''}
                    </p>
                </div>

                {/* Active channel badge */}
                {selectedChannel && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/20 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                        <span className="text-[0.6875rem] font-semibold text-[var(--accent)] whitespace-nowrap">
                            {channelDisplayName(selectedChannel)}
                        </span>
                    </div>
                )}
            </div>

            {/* GPS state — button for delivery persons, invisible for admins */}
            <VehicleSwitch />

            <button
                className="px-3 py-2 rounded-lg bg-transparent border border-[var(--card-border)] text-[var(--text-muted)] text-[0.75rem] font-medium cursor-pointer transition-all duration-200 hover:border-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] whitespace-nowrap shrink-0"
                onClick={onLogout}
            >
                Sign Out
            </button>
        </header>
    );
}
