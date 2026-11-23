import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy for GraphQL requests that CARRY FILES.
 *
 * The sibling /api/graphql route handles every JSON operation in this dashboard.
 * It cannot handle this one, and the reason is worth stating so nobody merges the
 * two back together:
 *
 *   1. It rewrites the request as `Content-Type: application/json`. A multipart
 *      body's boundary — the random string that tells the server where each part
 *      begins — lives ONLY in that header. Discard it and the server is handed a
 *      body it has no way to split, so it tries to JSON.parse the whole thing and
 *      answers 400.
 *
 *   2. It reads the body with `request.text()`, which means "decode these bytes as
 *      UTF-8". Raw JPEG bytes are not valid UTF-8; every invalid byte becomes
 *      U+FFFD, and re-encoding produces different bytes. The upload would arrive
 *      as a corrupt image even if the boundary survived.
 *
 * So this route exists instead of a change to that one. Every other screen in the
 * dashboard — orders, reports, price matrix, location stock, the delivery partner
 * views — goes through the JSON route, and leaving it untouched means none of them
 * can be affected by anything here.
 *
 * The body is read as an ArrayBuffer rather than streamed. Streaming would need
 * `duplex: 'half'`, which is absent from the DOM `RequestInit` types and behaves
 * differently across runtimes; buffering is byte-exact, needs no such flag, and
 * damage photos are small enough that holding one request in memory costs nothing.
 * (Worth remembering if this is ever deployed somewhere with a serverless request
 * size cap — that cap, not this code, is what a very large upload would hit.)
 *
 * Used by exactly one operation: createDamageRequest. See
 * services/goods-transfer.service.ts.
 */

const VENDURE_API_URL = process.env.NEXT_PUBLIC_VENDURE_ADMIN_API!;

export async function POST(request: NextRequest) {
    const contentType = request.headers.get('content-type') ?? '';

    // Refused rather than forwarded, so this can never quietly become a second
    // general-purpose proxy sitting beside /api/graphql. There is one way through
    // for JSON, and it is the other route.
    if (!contentType.startsWith('multipart/form-data')) {
        return NextResponse.json(
            {
                errors: [
                    {
                        message:
                            'This endpoint accepts multipart/form-data only. Send JSON operations to /api/graphql.',
                    },
                ],
            },
            { status: 415 },
        );
    }

    // Byte-for-byte, no decode step.
    const body = await request.arrayBuffer();

    // Forward the Vendure session cookie from the incoming request.
    const cookieHeader = request.headers.get('cookie') ?? '';

    // Forward the channel token so Vendure scopes the write to the selected channel,
    // identically to the JSON route.
    const channelToken = request.headers.get('vendure-token') ?? '';

    const res = await fetch(VENDURE_API_URL, {
        method: 'POST',
        headers: {
            // The ORIGINAL header, boundary and all. This is the whole point.
            'Content-Type': contentType,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(channelToken ? { 'vendure-token': channelToken } : {}),
        },
        body,
    });

    const data = await res.text();

    const response = new NextResponse(data, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
    });

    // Forward all Set-Cookie headers (session refresh), same as the JSON route.
    const setCookies = res.headers.getSetCookie();
    for (const cookie of setCookies) {
        response.headers.append('Set-Cookie', cookie);
    }

    return response;
}
