'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
    interface Window {
        __PWA_INSTALL_EVENT: BeforeInstallPromptEvent | null;
    }
}

/**
 * PWA Install Banner — always shows an actionable "Install App" button.
 *
 * The beforeinstallprompt event is captured globally in <head> (layout.tsx)
 * so it's never lost even if it fires before React hydrates. This component
 * reads from window.__PWA_INSTALL_EVENT and also listens for late events.
 *
 * When the user taps Install, the button waits up to 3s for the event to
 * arrive (SW might still be activating). Only falls back to a guide if the
 * event truly never arrives.
 */
export function PWAInstallBanner() {
    const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const installEventRef = useRef<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        // Already running as installed PWA
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsStandalone(true);
            return;
        }

        // Detect iOS
        setIsIOS(
            /iPad|iPhone|iPod/.test(navigator.userAgent) &&
            !(window as unknown as Record<string, unknown>).MSStream
        );

        // Pick up the event if it was already captured by the <head> script
        if (window.__PWA_INSTALL_EVENT) {
            installEventRef.current = window.__PWA_INSTALL_EVENT;
            setInstallEvent(window.__PWA_INSTALL_EVENT);
        }

        // Keep listening for late events (e.g. after SW activates)
        const handler = (e: Event) => {
            e.preventDefault();
            const event = e as BeforeInstallPromptEvent;
            window.__PWA_INSTALL_EVENT = event;
            installEventRef.current = event;
            setInstallEvent(event);
        };
        window.addEventListener('beforeinstallprompt', handler);
        window.addEventListener('appinstalled', () => setIsStandalone(true));
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const triggerPrompt = useCallback(async (event: BeforeInstallPromptEvent) => {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === 'accepted') setIsStandalone(true);
        window.__PWA_INSTALL_EVENT = null;
        installEventRef.current = null;
        setInstallEvent(null);
        setWaiting(false);
    }, []);

    const handleInstall = useCallback(async () => {
        // Check all sources for the event
        const event = installEventRef.current ?? installEvent ?? window.__PWA_INSTALL_EVENT;

        if (event) {
            await triggerPrompt(event);
            return;
        }

        // Event not available yet — wait up to 3s for it to arrive
        setWaiting(true);

        // Poll every 300ms for up to 3s
        let attempts = 0;
        const interval = setInterval(async () => {
            attempts++;
            const evt = installEventRef.current ?? window.__PWA_INSTALL_EVENT;
            if (evt) {
                clearInterval(interval);
                await triggerPrompt(evt);
                return;
            }
            if (attempts >= 10) {
                clearInterval(interval);
                setWaiting(false);
            }
        }, 300);
    }, [installEvent, triggerPrompt]);

    // Don't show if already installed or user dismissed
    if (isStandalone || dismissed) return null;

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col gap-3 px-4 py-4 rounded-2xl shadow-2xl"
            style={{
                zIndex: 9999,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.97), rgba(139,92,246,0.97))',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.2)',
                maxWidth: 'calc(100vw - 2rem)',
                width: '360px',
                boxShadow: '0 20px 60px rgba(99,102,241,0.4)',
            }}
        >
            {/* Header row */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="text-white font-semibold text-[0.8125rem] leading-tight">Install Delivery App</p>
                    <p className="text-white/70 text-[0.6875rem] leading-tight">Add to home screen for quick access</p>
                </div>
                <button
                    onClick={() => setDismissed(true)}
                    className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer hover:bg-white/20"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {/* Install button — behaviour depends on whether native prompt is ready */}
            {installEvent ? (
                /* ✅ Native Chrome install dialog is ready — one tap installs */
                <button
                    onClick={handleInstall}
                    disabled={waiting}
                    className="w-full py-2.5 rounded-xl text-[0.875rem] font-bold cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait"
                    style={{ background: 'white', color: '#6366f1' }}
                >
                    {waiting ? 'Opening installer…' : '⚡ Install App'}
                </button>
            ) : (
                /* ⏳ Chrome hasn't fired beforeinstallprompt yet — show manual steps */
                <div className="rounded-xl bg-white/10 px-3 py-3 text-[0.75rem] text-white leading-relaxed">
                    <p className="font-semibold mb-1.5 text-white">To install, do this once:</p>
                    {isIOS ? (
                        <ol className="list-decimal list-inside space-y-1 text-white/85">
                            <li>Tap the <strong>Share ⎋</strong> button at the bottom of Safari</li>
                            <li>Tap <strong>&ldquo;Add to Home Screen&rdquo; ➕</strong></li>
                        </ol>
                    ) : (
                        <ol className="list-decimal list-inside space-y-1 text-white/85">
                            <li>Tap <strong>⋮ menu</strong> in Chrome (top-right)</li>
                            <li>Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong></li>
                        </ol>
                    )}
                    <p className="mt-2 text-white/50 text-[0.6875rem]">
                        Auto-install button activates after Chrome verifies the app. ✓
                    </p>
                </div>
            )}
        </div>
    );
}
