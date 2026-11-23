import { NextRequest, NextResponse } from 'next/server';

const VENDURE_API_URL = process.env.NEXT_PUBLIC_VENDURE_ADMIN_API!;

export async function POST(request: NextRequest) {
    const body = await request.text();

    // Forward the Vendure session cookie from the incoming request
    const cookieHeader = request.headers.get('cookie') ?? '';

    // Forward the channel token so Vendure scopes all data to the selected channel.
    // The client sends this as "vendure-token" when a channel is selected in the sidebar.
    // This is identical to how Vendure Admin UI's channel switcher works.
    const channelToken = request.headers.get('vendure-token') ?? '';

    const res = await fetch(VENDURE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(channelToken ? { 'vendure-token': channelToken } : {}),
        },
        body,
    });

    const data = await res.text();

    // Create response and forward Set-Cookie headers from Vendure
    const response = new NextResponse(data, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
    });

    // Forward all Set-Cookie headers (session cookies)
    const setCookies = res.headers.getSetCookie();
    for (const cookie of setCookies) {
        response.headers.append('Set-Cookie', cookie);
    }

    return response;
}
