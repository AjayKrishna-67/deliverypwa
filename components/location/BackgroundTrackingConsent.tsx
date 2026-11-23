'use client';

/**
 * Prominent disclosure for background location — required by Google Play
 * before the app requests location for a foreground-service ride tracker.
 * Shown once (per device) when a ride starts inside the native app; agreeing
 * stores consent and lets the provider start the native watcher, which then
 * fires the actual system permission prompt.
 */

interface BackgroundTrackingConsentProps {
    onAgree: () => void;
    onDismiss: () => void;
}

export function BackgroundTrackingConsent({ onAgree, onDismiss }: BackgroundTrackingConsentProps) {
    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur-sm">
            <div
                className="w-full max-w-md m-3 mb-5 rounded-2xl p-5"
                style={{ background: 'var(--card-bg, var(--surface))', border: '1px solid var(--card-border, rgb(var(--overlay-rgb)/0.12))' }}
            >
                <div className="flex items-center gap-3 mb-3">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(20,184,166,0.15)' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tone-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="10" r="3" />
                            <path d="M12 2a8 8 0 00-8 8c0 5.4 7.05 11.5 7.35 11.76a1 1 0 001.3 0C13 21.5 20 15.4 20 10a8 8 0 00-8-8z" />
                        </svg>
                    </span>
                    <h2 className="text-[1rem] font-bold text-[var(--foreground,#fff)]">
                        Location during deliveries
                    </h2>
                </div>
                <p className="text-[0.8125rem] leading-relaxed text-[var(--foreground,#fff)] mb-2">
                    <strong>Kaaikani Delivery collects location data</strong> to share your live
                    position with the store and record your ride distance while a delivery is
                    in progress — <strong>even when the app is closed or not in use</strong>.
                </p>
                <p className="text-[0.8125rem] leading-relaxed text-[var(--text-muted,#9ca3af)] mb-4">
                    A &ldquo;Delivery in progress&rdquo; notification stays visible whenever
                    tracking is on, and tracking stops as soon as the order is delivered.
                </p>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={onAgree}
                        className="w-full py-3 rounded-xl text-[0.875rem] font-semibold text-white cursor-pointer"
                        style={{ background: 'var(--accent, #6366f1)' }}
                    >
                        Agree — turn on ride tracking
                    </button>
                    <button
                        onClick={onDismiss}
                        className="w-full py-2.5 rounded-xl text-[0.8125rem] font-medium cursor-pointer text-[var(--text-muted,#9ca3af)]"
                        style={{ background: 'rgb(var(--overlay-rgb)/0.06)' }}
                    >
                        Not now — track only while the app is open
                    </button>
                </div>
            </div>
        </div>
    );
}
