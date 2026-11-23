'use client';

/**
 * Theme provider — light / dark / system.
 *
 * next-themes does the hard part: it injects a tiny blocking script that reads
 * the saved choice (localStorage "theme") and puts `light` or `dark` on <html>
 * before the first paint, so there is no flash of the wrong theme. "system"
 * follows prefers-color-scheme live, including when the OS flips at sunset.
 *
 * The colours themselves live in app/globals.css (`:root` = dark,
 * `:root.light` = light). Components only read CSS variables.
 */

import { useEffect, type ReactNode } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

export type ThemeChoice = 'light' | 'dark' | 'system';

/** Browser/PWA status-bar colour per resolved theme — matches --background.
 *  Repeated in app/layout.tsx `viewport` (a server file cannot import values
 *  from a 'use client' module). */
const THEME_COLOR: Record<'light' | 'dark', string> = {
    dark: '#0a0a0f',
    light: '#f4f5f9',
};

/**
 * Keeps the phone's status bar in step with the app theme, not the OS.
 *
 * Browser / installed PWA: the <meta name="theme-color"> tags from
 * app/layout.tsx follow the OS setting via their `media` query, so when the
 * user overrides it (dark phone, light app) they are repainted here.
 *
 * Capacitor app: the native status bar ignores theme-color, so its icon
 * colour is set through SystemBars — otherwise a light app on a dark phone
 * shows white clock/battery icons on a white bar.
 */
function ThemeColorSync() {
    const { resolvedTheme } = useTheme();

    useEffect(() => {
        if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return;
        document
            .querySelectorAll('meta[name="theme-color"]')
            .forEach((m) => m.setAttribute('content', THEME_COLOR[resolvedTheme]));

        if (Capacitor.isNativePlatform()) {
            SystemBars.setStyle({
                // DARK = light icons for a dark bar; LIGHT = dark icons for a light bar
                style: resolvedTheme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
            }).catch(() => {
                // Shell built without SystemBars — the bar keeps the OS default
            });
        }
    }, [resolvedTheme]);

    return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            // Many elements carry `transition-all`; without this they would
            // each animate to the new colours at their own speed.
            disableTransitionOnChange
        >
            <ThemeColorSync />
            {children}
        </NextThemesProvider>
    );
}
