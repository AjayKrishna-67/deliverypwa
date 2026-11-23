'use client';

/**
 * GpsRequiredGate — COMPULSORY GPS for delivery accounts.
 *
 * Fullscreen blocker (above every modal) shown whenever a logged-in user who
 * carries delivery transition permissions has GPS in 'prompt' or 'denied'
 * state. The app is unusable behind it until location is granted — and if
 * permission is revoked mid-session, the gate comes straight back.
 *
 * Applies to the same accounts the backend offers in the "Own Delivery
 * Fleet" dropdown: a channel role granting BOTH TransitionToOutForDelivery
 * and TransitionToDelivered, excluding SuperAdmin (see lib/roles.ts).
 * Everyone else gets the optional LocationGate card instead. Environment
 * limits (no HTTPS, no geolocation hardware) are NOT hard-blocked — the
 * device can't comply, so those fall through to the soft banner.
 *
 * The DriverLocationProvider listens to the Permissions API, so the moment
 * the user allows location (in the dialog or in site settings) the gate
 * disappears on its own — no reload needed on Chromium.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { useDriverLocation } from '@/providers/DriverLocationProvider';
import { isDeliveryPersonUser } from '@/lib/roles';
import { isNativeApp, openNativeLocationSettings } from '@/lib/native-tracking';
import { EnableLocationHelp } from '@/components/location/EnableLocationHelp';

export function GpsRequiredGate() {
    const { status, requestPermission, retryGps, lastError, fixIssue, gpsChecking } = useDriverLocation();
    const { currentUser, isAuthenticated, logout } = useAuth();
    const router = useRouter();
    const [showHelp, setShowHelp] = useState(false);

    const required = isAuthenticated && isDeliveryPersonUser(currentUser);
    // Permission granted but the phone's Location switch is OFF — "GPS is
    // required to use this app" means this blocks too, not just the prompt.
    // App shell only: there a code-2 error reliably means the switch (the
    // WebView reports it at once). In browsers code 2 also comes from
    // desktop builds without a network-location provider or a brief
    // offline moment — those stay soft, as the header documents, and a
    // phone browser with Location off surfaces as 'denied' anyway.
    // (The delivery page has its own strip; it doesn't mount this gate, so a
    // ride in progress can always be finished.)
    // Shown whatever the permission state (a rider may need both): the
    // card's Try again asks for permission and then raises the enable sheet.
    const locationOff =
        required && isNativeApp() && status !== 'denied' && fixIssue?.kind === 'unavailable';

    // (No polling here: the provider re-reads the phone's Location switch
    // every few seconds in the app shell, so this card clears by itself.)

    if (!required) return null;
    if (status !== 'prompt' && status !== 'denied' && !locationOff) return null;

    const denied = status === 'denied';

    async function handleSignOut() {
        await logout();
        router.replace('/login');
    }

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-6"
            style={{ background: 'var(--background)' }}
        >
            {/* Rendered inside the gate's stacking context so it sits above it */}
            {showHelp && <EnableLocationHelp onClose={() => setShowHelp(false)} />}

            <div className="w-full max-w-sm flex flex-col items-center text-center gap-4">
                <span className="text-6xl leading-none" aria-hidden>
                    {denied ? '🚫' : locationOff ? '📵' : '📍'}
                </span>

                <h1 className="text-[1.25rem] font-bold text-[var(--foreground)]">
                    {denied ? 'GPS is blocked' : locationOff ? 'Phone Location is off' : 'Location access'}
                </h1>

                {denied || locationOff ? (
                    <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
                        {denied
                            ? 'Location is blocked for this app. Delivery work needs your live location — allow it in settings, then come back here. If this screen is still showing, tap "I allowed it — Reload".'
                            : 'Swipe down from the top of the screen and turn on Location, then come back here. Delivery work needs your live location.'}
                    </p>
                ) : (
                    /* PROMINENT DISCLOSURE (Google Play User Data policy): what is
                       collected, what it is used for, that it can run in the
                       background — shown in-app, immediately before the runtime
                       permission request, and passed only by an affirmative tap. */
                    <div
                        className="w-full rounded-xl p-4 text-left flex flex-col gap-2.5"
                        style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                    >
                        <p className="text-[0.8125rem] leading-relaxed text-[var(--foreground)]">
                            <strong>Kaaikani Delivery collects your location</strong> to show order
                            distances, guide you to customers, share your live position with the store
                            during a delivery and record ride distance —{' '}
                            <strong>even when the app is in the background or the screen is off</strong>{' '}
                            during an active delivery.
                        </p>
                        <p className="text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
                            Never sold or used for ads. Tap Agree to continue.
                        </p>
                    </div>
                )}

                {lastError && (
                    <p
                        className="w-full rounded-xl p-3 text-[0.8125rem] leading-relaxed text-left text-[var(--foreground)]"
                        style={{ background: 'var(--error-bg)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    >
                        <span aria-hidden>⚠️ </span>
                        {lastError}
                    </p>
                )}

                {locationOff ? (
                    <div className="w-full flex flex-col gap-2.5">
                        <button
                            onClick={openNativeLocationSettings}
                            className="w-full py-3 rounded-xl text-[0.875rem] font-bold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors"
                        >
                            📍 Open Location settings
                        </button>
                        <button
                            onClick={retryGps}
                            disabled={gpsChecking}
                            className="w-full py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer transition-colors border border-[var(--card-border)] text-[var(--foreground)] hover:bg-overlay/5 disabled:opacity-60"
                        >
                            {gpsChecking ? 'Checking GPS…' : 'I turned it on — Try again'}
                        </button>
                    </div>
                ) : denied ? (
                    <div className="w-full flex flex-col gap-2.5">
                        <button
                            onClick={() => {
                                // Safari / temporary blocks re-prompt; hard Chrome
                                // denies fall through to the help steps. In the
                                // native shell the help's "Open app settings" is
                                // the path — re-asking here would drop the system
                                // dialog underneath the help sheet.
                                if (!isNativeApp()) requestPermission();
                                setShowHelp(true);
                            }}
                            className="w-full py-3 rounded-xl text-[0.875rem] font-bold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors"
                        >
                            How to enable location
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 rounded-xl text-[0.875rem] font-semibold cursor-pointer border border-[var(--card-border)] text-[var(--foreground)] hover:bg-overlay/5 transition-colors"
                        >
                            I allowed it — Reload
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={requestPermission}
                        disabled={gpsChecking}
                        className="w-full py-3 rounded-xl text-[0.875rem] font-bold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60"
                    >
                        {gpsChecking ? 'Checking GPS…' : 'Agree & continue'}
                    </button>
                )}

                <button
                    onClick={handleSignOut}
                    className="mt-2 text-[0.75rem] font-medium cursor-pointer bg-transparent border-none text-[var(--text-muted)] hover:text-[var(--error)] transition-colors"
                >
                    {denied || locationOff ? 'Sign out' : 'No thanks — sign out'}
                </button>
            </div>
        </div>
    );
}
