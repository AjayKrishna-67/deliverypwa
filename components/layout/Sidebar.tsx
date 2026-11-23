'use client';

/**
 * Sidebar — collapsible left navigation panel.
 * Expanded: icons + labels + channel dropdown.
 * Collapsed: icons only, narrow strip.
 */

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { isSuperadmin, hasPermission, hasPermissionAnyChannel } from '@/lib/is-superadmin';
import { canSeeGoodsTransfer } from '@/lib/goods-transfer-permissions';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export interface SidebarChannel {
    id: string;
    code: string;
    token: string;
    customFields?: {
        type?: string | null;
        enabled?: boolean | null;
        invoiceGroup?: string | null;
    } | null;
}

interface SidebarProps {
    channels: SidebarChannel[];
    selectedChannelId: string | null;
    onChannelSelect: (channel: SidebarChannel) => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

const NAV_LINKS = [
    {
        href: '/',
        label: 'Home',
        exact: true,
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
        ),
    },
    {
        href: '/orders',
        label: 'Orders',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="13" y2="16" />
            </svg>
        ),
    },
    {
        href: '/reports',
        label: 'Reports',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="12" width="4" height="9" rx="1" />
                <rect x="10" y="7" width="4" height="14" rx="1" />
                <rect x="17" y="3" width="4" height="18" rx="1" />
            </svg>
        ),
    },
    {
        href: '/fleet',
        label: 'Fleet',
        // Fleet monitoring is for admins/owners — anyone who can view delivery
        // reports or create fulfillments. Delivery persons carry neither, so
        // the entry stays hidden for them (matches the backend @Allow guard).
        requiredAnyPermissionAnyChannel: ['ViewDeliveryReports', 'CustomFulfillment'],
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3" />
                <path d="M12 2a8 8 0 00-8 8c0 5.4 7.05 11.5 7.35 11.76a1 1 0 001.3 0C13 21.5 20 15.4 20 10a8 8 0 00-8-8z" />
            </svg>
        ),
    },
    {
        href: '/price-matrix',
        label: 'Price update',
        requiredPermission: 'UpdateCatalog',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
        ),
    },
    {
        href: '/location-stock',
        label: 'Location Stock',
        // Global (any-channel) read on both tables the tool touches. Matches the
        // page gate + backend assertGlobalPermissions.
        requiredPermissionsAnyChannel: ['ReadProduct', 'ReadStockLocation'],
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
        ),
    },
    {
        href: '/goods-transfer',
        label: 'Goods Transfer',
        // Held apart from requiredPermissionsAnyChannel because that field means
        // "all of these", and this gate is "either of these": a role granted only
        // ViewTransferReports should still reach the section.
        //
        // Both permissions are declared by the backend Goods Transfer plugin, so on
        // a server without it no role can hold them, nobody's permission list
        // contains them, and this link never renders. That is what makes shipping
        // this section ahead of the backend safe rather than merely tidy.
        canShow: canSeeGoodsTransfer,
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="7" width="12" height="9" rx="1" />
                <path d="M13 10h4l4 3v3h-8z" />
                <circle cx="5.5" cy="19" r="1.75" />
                <circle cx="17.5" cy="19" r="1.75" />
            </svg>
        ),
    },
    {
        href: '/price-history',
        label: 'Price History',
        superAdminOnly: true,
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v5h5" />
                <path d="M3.05 13A9 9 0 106 5.3L3 8" />
                <polyline points="12 7 12 12 15 15" />
            </svg>
        ),
    },
];

function channelLabel(ch: SidebarChannel): string {
    if (ch.code === '__default_channel__') return 'All Channels';
    return ch.code
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

const CHANNEL_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
    '#f59e0b', '#10b981', '#3b82f6', '#ef4444',
];

function channelColor(index: number) {
    return CHANNEL_COLORS[index % CHANNEL_COLORS.length];
}

/** Translucent version of a colour. color-mix() rather than appending hex
 *  alpha (`${c}22`), which silently breaks when the colour is a var(). */
function tint(color: string, percent: number) {
    return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

// ─── Channel Dropdown ────────────────────────────────────────────────

interface ChannelDropdownProps {
    channels: SidebarChannel[];
    selected: SidebarChannel | null;
    onSelect: (ch: SidebarChannel) => void;
    collapsed?: boolean;
}

function ChannelDropdown({ channels, selected, onSelect, collapsed }: ChannelDropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    const selectedIdx = selected ? channels.findIndex((c) => c.id === selected.id) : -1;
    const selectedColor = selectedIdx >= 0 ? channelColor(selectedIdx) : 'var(--accent)';
    const selectedLabel = selected ? channelLabel(selected) : 'Select channel';

    return (
        <div ref={ref} className="relative px-2 py-2.5 border-b border-[var(--card-border)]">
            <button
                onClick={() => setOpen((v) => !v)}
                className={`w-full flex items-center rounded-xl transition-all duration-150 cursor-pointer ${collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-3 py-2.5'}`}
                style={{
                    background: 'rgb(var(--overlay-rgb)/0.06)',
                    border: '1px solid rgb(var(--overlay-rgb)/0.1)',
                }}
                title={collapsed ? selectedLabel : undefined}
            >
                <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: tint(selectedColor, 13), border: `1px solid ${tint(selectedColor, 27)}` }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={selectedColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 17 12 22 22 17" />
                        <polyline points="2 12 12 17 22 12" />
                    </svg>
                </span>

                {!collapsed && (
                    <>
                        <span className="flex-1 text-left text-[0.875rem] font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                            {selectedLabel}
                        </span>
                        <svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', flexShrink: 0 }}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </>
                )}
            </button>

            {open && (
                <div
                    className="absolute left-2 right-2 top-[calc(100%-4px)] rounded-xl overflow-y-auto z-50 py-1"
                    style={{
                        background: 'var(--surface)',
                        border: '1px solid rgb(var(--overlay-rgb)/0.12)',
                        boxShadow: 'var(--shadow-popover)',
                        maxHeight: '280px',
                        minWidth: collapsed ? '200px' : undefined,
                    }}
                >
                    {channels.map((ch, idx) => {
                        const isActive = ch.id === selected?.id;
                        const color = channelColor(idx);
                        return (
                            <button
                                key={ch.id}
                                onClick={() => { onSelect(ch); setOpen(false); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 transition-all duration-100 cursor-pointer text-left"
                                style={{
                                    background: isActive ? tint(color, 9) : 'transparent',
                                    borderLeft: isActive ? `2px solid ${color}` : '2px solid transparent',
                                }}
                            >
                                <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: tint(color, 13) }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                        <polyline points="2 17 12 22 22 17" />
                                        <polyline points="2 12 12 17 22 12" />
                                    </svg>
                                </span>
                                <span className="text-[0.8125rem] font-medium truncate" style={{ color: isActive ? color : 'var(--foreground)' }}>
                                    {channelLabel(ch)}
                                </span>
                                {isActive && (
                                    <svg className="ml-auto shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Main Sidebar ────────────────────────────────────────────────────

export function Sidebar({ channels, selectedChannelId, onChannelSelect, collapsed, onToggleCollapse }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const { currentUser } = useAuth();
    const showSuperAdmin = isSuperadmin(currentUser);
    const navLinks = NAV_LINKS.filter((link) => {
        if ('superAdminOnly' in link && link.superAdminOnly && !showSuperAdmin) {
            return false;
        }
        if ('requiredPermissionsAnyChannel' in link && link.requiredPermissionsAnyChannel) {
            return link.requiredPermissionsAnyChannel.every((p) => hasPermissionAnyChannel(currentUser, p));
        }
        if ('requiredAnyPermissionAnyChannel' in link && link.requiredAnyPermissionAnyChannel) {
            return link.requiredAnyPermissionAnyChannel.some((p) => hasPermissionAnyChannel(currentUser, p));
        }
        if ('requiredPermission' in link && link.requiredPermission) {
            return hasPermission(currentUser, link.requiredPermission);
        }
        // An escape hatch for gates the three fields above cannot express — they are
        // all "this permission" or "all of these permissions", and some sections are
        // reached by either of two.
        if ('canShow' in link && link.canShow) {
            return link.canShow(currentUser);
        }
        return true;
    });
    const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? null;

    const width = collapsed ? '60px' : '220px';

    return (
        <aside
            style={{ width, minWidth: width, transition: 'width 0.2s ease, min-width 0.2s ease' }}
            className="flex flex-col h-screen sticky top-0 overflow-visible border-r border-[var(--card-border)] bg-[var(--sidebar-bg)] backdrop-blur-xl z-20 shrink-0"
        >
            {/* ── Logo + Toggle ── */}
            <div className={`flex items-center border-b border-[var(--card-border)] ${collapsed ? 'justify-center px-2 py-3.5' : 'justify-between px-3 py-3.5'}`}>
                <div className={`flex items-center gap-2 ${collapsed ? '' : ''}`}>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center shrink-0">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 18H3a2 2 0 01-2-2V8a2 2 0 012-2h3.19M15 6h2a2 2 0 012 2v8a2 2 0 01-2 2h-3.19" />
                            <line x1="23" y1="13" x2="23" y2="11" />
                            <polyline points="11 6 7 12 11 18" />
                            <polyline points="17 6 13 12 17 18" />
                        </svg>
                    </div>
                    {!collapsed && (
                        <span className="text-[0.9375rem] font-bold tracking-tight text-[var(--foreground)]">
                            Delivery
                        </span>
                    )}
                </div>

                {/* Toggle button — always visible */}
                {onToggleCollapse && !collapsed && (
                    <button
                        onClick={onToggleCollapse}
                        className="w-7 h-7 rounded-md flex items-center justify-center cursor-pointer transition-colors hover:bg-overlay/10"
                        style={{ color: 'var(--text-muted)' }}
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                            <polyline points="14 9 11 12 14 15" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Expand button when collapsed — below logo */}
            {onToggleCollapse && collapsed && (
                <div className="flex justify-center py-2 border-b border-[var(--card-border)]">
                    <button
                        onClick={onToggleCollapse}
                        className="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer transition-colors hover:bg-overlay/10"
                        style={{ color: 'var(--text-muted)' }}
                        title="Expand sidebar"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <line x1="9" y1="3" x2="9" y2="21" />
                            <polyline points="13 9 16 12 13 15" />
                        </svg>
                    </button>
                </div>
            )}

            {/* ── Channel Dropdown ── */}
            {channels.length === 0 ? (
                <div className="px-2 py-2.5 border-b border-[var(--card-border)]">
                    <div className="h-10 rounded-xl animate-pulse" style={{ background: 'rgb(var(--overlay-rgb)/0.06)' }} />
                </div>
            ) : (
                <ChannelDropdown
                    channels={channels}
                    selected={selectedChannel}
                    onSelect={onChannelSelect}
                    collapsed={collapsed}
                />
            )}

            {/* ── Navigation ── */}
            <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-1.5 pt-3' : 'px-2 pt-3'}`}>
                {!collapsed && (
                    <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)] px-2 mb-2">
                        Pages
                    </p>
                )}
                <ul className="flex flex-col gap-0.5">
                    {navLinks.map((link) => {
                        const isActive = ('exact' in link && link.exact) ? pathname === link.href : pathname.startsWith(link.href);
                        return (
                            <li key={link.href}>
                                <button
                                    onClick={() => router.push(link.href)}
                                    className={`w-full flex items-center rounded-lg transition-all duration-150 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2 text-left'}`}
                                    style={{
                                        background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                                        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                                        border: isActive ? '1px solid rgba(99,102,241,0.25)' : '1px solid transparent',
                                    }}
                                    title={collapsed ? link.label : undefined}
                                >
                                    <span className="shrink-0 opacity-90">{link.icon}</span>
                                    {!collapsed && (
                                        <span className="text-[0.8125rem] font-medium">{link.label}</span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* ── Theme ── pinned to the bottom; safe-area padding keeps it
                clear of the gesture bar on notched phones */}
            <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <ThemeToggle collapsed={collapsed} />
            </div>
        </aside>
    );
}
