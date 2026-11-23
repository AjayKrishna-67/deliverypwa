'use client';

/**
 * LocationGate — permission UI for delivery-person GPS.
 *
 * Rendered inside DashboardLayout above the page content, so it appears on
 * every authenticated page right after login. Renders nothing for admins
 * (provider status stays 'idle') and nothing once permission is granted —
 * so for most sessions this component is invisible.
 *
 * 'prompt'  → explanatory card with an Enable button (fires the native prompt
 *             from a user gesture — never auto-fired, see DriverLocationProvider)
 * 'denied'  → persistent banner with recovery instructions
 * 'insecure'/'unsupported' → informational banner
 */

import { useState } from 'react';
import { useDriverLocation } from '@/providers/DriverLocationProvider';
import { ModalPortal } from '@/components/orders/ModalPortal';
import { EnableLocationHelp } from '@/components/location/EnableLocationHelp';

export function LocationGate() {
    const { status, requestPermission, lastError } = useDriverLocation();
    const [showHelp, setShowHelp] = useState(false);

    if (status === 'prompt') {
        return (
            <div
                className="mx-4 mt-4 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
                <span className="text-2xl leading-none" aria-hidden>📍</span>
                <div className="flex-1 min-w-0">
                    <p className="text-[0.875rem] font-semibold text-[var(--foreground)]">
                        Enable location
                    </p>
                    <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5">
                        Needed to show the distance to each delivery and navigate to customers.
                    </p>
                    {lastError && (
                        <p className="text-[0.75rem] mt-1" style={{ color: 'var(--error)' }}>
                            {lastError}
                        </p>
                    )}
                </div>
                <button
                    onClick={requestPermission}
                    className="shrink-0 rounded-lg px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                >
                    Enable Location
                </button>
            </div>
        );
    }

    if (status === 'denied') {
        return (
            <>
                {showHelp && (
                    <ModalPortal>
                        <EnableLocationHelp onClose={() => setShowHelp(false)} />
                    </ModalPortal>
                )}
                <div
                    className="mx-4 mt-4 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-2.5"
                    style={{
                        background: 'var(--error-bg)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                >
                    <p className="flex-1 text-[0.75rem] leading-relaxed" style={{ color: 'var(--error)' }}>
                        <span aria-hidden>🚫 </span>
                        <span className="font-semibold">Location access is blocked.</span>{' '}
                        Delivery distances and navigation won&apos;t work until you allow it.
                    </p>
                    <button
                        onClick={() => {
                            // Re-prompts on Safari/temporary blocks; on a hard
                            // Chrome deny the help dialog shows the settings path
                            requestPermission();
                            setShowHelp(true);
                        }}
                        className="shrink-0 rounded-lg px-4 py-2 text-[0.8125rem] font-semibold text-white cursor-pointer transition-colors bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                    >
                        How to enable
                    </button>
                </div>
            </>
        );
    }

    if (status === 'insecure' || status === 'unsupported') {
        return (
            <div
                className="mx-4 mt-4 rounded-xl p-3.5"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
                <p className="text-[0.75rem] text-[var(--text-muted)]">
                    {status === 'insecure'
                        ? 'Location needs a secure (HTTPS) connection — distances are unavailable here.'
                        : 'This browser does not support location — distances are unavailable.'}
                </p>
            </div>
        );
    }

    // 'idle' (admin / logged out) or 'granted' — nothing to show
    return null;
}
