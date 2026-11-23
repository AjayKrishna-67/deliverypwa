import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
    '/login',
    '/api',
    '/_next',
    '/favicon.ico',
    '/manifest.webmanifest',
    '/sw.js',
    '/icons',
    '/kaaikanilogo.png',
    '/.well-known', // Digital Asset Links (assetlinks.json) — must serve raw, no auth redirect
    '/privacy-policy', // Public — Play/App Store reviewers open it logged-out
    '/downloads', // Public — rider app APK (public/downloads/), shared by link
];

// Next 16 "proxy" (formerly middleware). Runs on the Node.js runtime — proxy
// does not support `runtime = 'edge'`, and a cookie check doesn't need it.
export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow all public paths without any redirect logic
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // For protected routes: check for Vendure session cookie
    // Note: having a cookie doesn't guarantee a valid session —
    // the AuthContext handles that client-side
    const session = request.cookies.get('session');
    if (!session) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image).*)'],
};
