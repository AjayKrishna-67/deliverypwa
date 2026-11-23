'use client';

/**
 * EnableLocationHelp — step-by-step unblock instructions, shown when the
 * user taps "GPS blocked".
 *
 * Once a browser permission is set to Block, NO website can re-open the
 * native prompt (anti-spam rule) — the user must flip it in site settings.
 * The DriverLocationProvider subscribes to the Permissions API, so the
 * moment they set it to Allow, status flips to 'granted' and the UI that
 * renders this dialog unmounts it automatically — no reload needed on
 * Chromium. The Reload button is the fallback for browsers that don't
 * fire the change event.
 */

import { isNativeApp, openNativeAppSettings } from '@/lib/native-tracking';

interface EnableLocationHelpProps {
    onClose: () => void;
}

/** Browser / old TWA: three places a block can live. The site-settings
 *  fallback covers Chrome's automatic block after several closed prompts,
 *  which leaves the site at "Ask" so nothing shows under the lock icon. */
const BROWSER_STEPS: Array<{ title: string; steps: string }> = [
    {
        title: '📍 Phone location off?',
        steps: 'Swipe down from the top of the screen → tap Location to turn it on → Reload',
    },
    {
        title: '🌐 In browser',
        steps:
            'Tap the lock (or ⚙) icon near the address → Permissions → Location → Allow. ' +
            'Not listed? Chrome ⋮ → Settings → Site settings → Location → allow this site',
    },
    {
        title: '📱 Chrome itself',
        steps: 'Phone Settings → Apps → Chrome → Permissions → Location → Allow',
    },
    {
        title: '📲 Installed app',
        steps: 'Phone Settings → Apps → Kaaikani Delivery → Permissions → Location → Allow',
    },
];

/** Capacitor shell: only the app's own Android permission exists — no lock
 *  icon, no Chrome. openNativeAppSettings() deep-links straight there. */
const NATIVE_STEPS: Array<{ title: string; steps: string }> = [
    {
        title: '📍 Phone location off?',
        steps: 'Swipe down from the top of the screen → tap Location to turn it on → Reload',
    },
    {
        title: '📲 Kaaikani Delivery app',
        steps: 'Phone Settings → Apps → Kaaikani Delivery → Permissions → Location → Allow',
    },
];

export function EnableLocationHelp({ onClose }: EnableLocationHelpProps) {
    // Only ever rendered after a tap, so no SSR/hydration concern here
    const native = isNativeApp();
    const steps = native ? NATIVE_STEPS : BROWSER_STEPS;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div
                className="relative w-full max-w-md rounded-2xl p-5 flex flex-col gap-4"
                style={{ background: 'var(--surface)', border: '1px solid var(--card-border)' }}
            >
                <div>
                    <p className="text-[0.9375rem] font-bold text-[var(--foreground)]">
                        📍 Location is blocked for this app
                    </p>
                    <p className="text-[0.75rem] text-[var(--text-muted)] mt-1 leading-relaxed">
                        Location was blocked earlier. Allow it once in settings:
                    </p>
                </div>

                <div className="flex flex-col gap-2.5">
                    {steps.map((s) => (
                        <div
                            key={s.title}
                            className="rounded-xl p-3"
                            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
                        >
                            <p className="text-[0.75rem] font-semibold text-[var(--foreground)]">{s.title}</p>
                            <p className="text-[0.7188rem] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                                {s.steps}
                            </p>
                        </div>
                    ))}
                </div>

                <p className="text-[0.7188rem] text-[var(--text-muted)]">
                    After allowing it, come back to the app. If this screen is still here, tap
                    Reload.
                    {!native &&
                        ' Chrome can also block a site on its own after its prompt is closed a few times — the steps above clear that too.'}
                </p>

                {native && (
                    <button
                        onClick={openNativeAppSettings}
                        className="w-full py-2.5 rounded-xl text-[0.8125rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                    >
                        Open app settings
                    </button>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl text-[0.8125rem] font-semibold cursor-pointer border border-[var(--card-border)] text-[var(--text-muted)] hover:bg-overlay/5"
                    >
                        Close
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="flex-1 py-2.5 rounded-xl text-[0.8125rem] font-semibold text-white cursor-pointer bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                    >
                        I allowed it — Reload
                    </button>
                </div>
            </div>
        </div>
    );
}
