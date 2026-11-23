import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { DriverLocationProvider } from '@/providers/DriverLocationProvider';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Delivery Dashboard',
  description: 'Channel-aware delivery order management dashboard',
  // manifest is auto-served by app/manifest.ts — no need to set it here
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Delivery',
    startupImage: '/icons/icon-512x512.png',
  },
  formatDetection: { telephone: false },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileImage': '/icons/icon-144x144.png',
    'msapplication-TileColor': '#6366f1',
    'msapplication-config': 'none',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
    { media: '(prefers-color-scheme: light)', color: '#f4f5f9' },
  ],
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,              // native apps don't allow pinch zoom
  viewportFit: 'cover',             // notch-safe on iPhone X+
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: inside the Capacitor shell, the native
    // SystemBars plugin writes --safe-area-inset-* CSS variables onto
    // <html style> BEFORE React hydrates (Android edge-to-edge support), so
    // the attribute never matches the server HTML. React keeps the client
    // value either way; this only silences the dev-overlay report. Applies
    // to this element's attributes only, not to children.
    // next-themes (ThemeProvider) also writes class="light|dark" and
    // style="color-scheme" here before hydration — same reason.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Register service worker for PWA — lets Chrome decide when to show install prompt */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener("beforeinstallprompt",function(e){
  // Do NOT call e.preventDefault() — let Chrome show its native install UI:
  // mini-infobar at bottom, install icon in address bar, "Install app" in menu.
  console.log("[PWA] Native install prompt available");
});`,
          }}
        />

        {/* Apple touch icons — required for iOS "Add to Home Screen" */}
        <link rel="apple-touch-icon" href="/icons/icon-180x180.png" />
        <link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
        <link rel="apple-touch-icon" sizes="144x144" href="/icons/icon-144x144.png" />
        <link rel="apple-touch-icon" sizes="120x120" href="/icons/icon-128x128.png" />

        {/* Shortcut icon (Ubuntu / older browsers) */}
        <link rel="shortcut icon" href="/icons/icon-192x192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AuthProvider>
            <DriverLocationProvider>{children}</DriverLocationProvider>
          </AuthProvider>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
