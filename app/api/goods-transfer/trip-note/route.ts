import { NextRequest, NextResponse } from 'next/server';

import { COMBINED_TRANSFER_DOCUMENT_QUERY } from '@/graphql/operations/goods-transfer';
import type { CombinedDocumentInput, CombinedTransferDocument } from '@/types/goods-transfer';

/**
 * The trip note, served as a real PDF at a real URL.
 *
 * WHY A ROUTE AND NOT A FETCH. The server hands this document back as base64 inside a
 * GraphQL answer, because it is built on demand and stored nowhere. A screen could
 * decode that into a blob and open it — but only after the request comes back, by
 * which time the click that started it is over, and a browser blocks a window opened
 * outside a gesture. The workarounds (a placeholder tab held open, a download
 * attribute, an inline viewer) all trade one platform's behaviour for another's.
 *
 * A URL has none of that difficulty. The screen knows it before the click, so
 * window.open happens IN the gesture, and what opens is the browser's own PDF viewer
 * — the same thing that already opens for a single transfer's document, on a phone as
 * much as on a desktop.
 *
 * It is the same shape as /api/graphql and /api/asset, and for the same reason: the
 * browser only ever talks to this server, and this server talks to Vendure.
 *
 * WHAT IT DOES NOT DO. It carries no authority of its own. The session cookie is
 * forwarded exactly as it arrived and Vendure decides; a request without one gets
 * whatever Vendure gives an anonymous caller, which is nothing. The channel token
 * rides in the query string because a navigation cannot set a header — it names which
 * branch is being acted as, which is not a secret, and the permission check on that
 * branch still happens on the server.
 */

const VENDURE_API_URL = process.env.NEXT_PUBLIC_VENDURE_ADMIN_API ?? '';

/**
 * A bare date to an unambiguous instant at the edge of that day, in the time zone the
 * branches actually keep.
 *
 * The date boxes hand over 'YYYY-MM-DD'. Read as-is that is midnight UTC, so a range
 * ending "today" ends at 5:30 in the morning IST and leaves out the very load the
 * person is trying to print. Saying the offset out loud is what makes the day a day.
 *
 * Anything already carrying a time is passed through untouched.
 */
function dayEdge(value: string | null, edge: 'start' | 'end'): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }
    return edge === 'start' ? `${trimmed}T00:00:00.000+05:30` : `${trimmed}T23:59:59.999+05:30`;
}

/** A readable page rather than a raw error, because this opens in a tab of its own. */
function errorPage(message: string, status: number): NextResponse {
    const safe = message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    return new NextResponse(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<title>Trip note</title>` +
            `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#14142a;` +
            `font:15px/1.6 system-ui,sans-serif;color:#e8e8f0">` +
            `<div style="max-width:32rem;padding:2rem;text-align:center">` +
            `<h1 style="font-size:1rem;margin:0 0 .75rem">The trip note could not be made</h1>` +
            `<p style="margin:0;color:#a0a0b8">${safe}</p></div>`,
        { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
}

export async function GET(request: NextRequest) {
    if (!VENDURE_API_URL) {
        return errorPage('This app has no Vendure API configured.', 500);
    }

    const params = request.nextUrl.searchParams;
    const channelToken = params.get('channel') ?? '';

    const list = (value: string | null) =>
        (value ?? '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

    // Named transfers win over the branch and date filters — the server says so too,
    // and this only has to pass them along.
    // The trip note is the sender's paper; the server reads it OUT whatever is sent.
    const input: CombinedDocumentInput = {
        transferIds: list(params.get('transfers')),
        branchIds: list(params.get('branches')),
        from: dayEdge(params.get('from'), 'start'),
        to: dayEdge(params.get('to'), 'end'),
    };

    let payload: {
        data?: { combinedTransferDocument?: CombinedTransferDocument };
        errors?: Array<{ message: string }>;
    };
    try {
        const res = await fetch(VENDURE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}),
                ...(channelToken ? { 'vendure-token': channelToken } : {}),
            },
            body: JSON.stringify({ query: COMBINED_TRANSFER_DOCUMENT_QUERY, variables: { input } }),
        });
        payload = await res.json();
    } catch {
        return errorPage('The server could not be reached.', 502);
    }

    /*
      A GraphQL error is the ordinary way this fails, and its message is written to be
      read — "no confirmed transfer matches that branch and date range" is the answer,
      not a fault. It is shown as it came rather than replaced with something vaguer.
    */
    const failure = payload.errors?.[0]?.message;
    if (failure) {
        return errorPage(failure, 400);
    }

    const document = payload.data?.combinedTransferDocument;
    if (!document?.content) {
        return errorPage('The server returned no document.', 502);
    }

    const pdf = Buffer.from(document.content, 'base64');
    return new NextResponse(pdf as unknown as BodyInit, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': String(pdf.length),
            // INLINE, so the browser's viewer shows it. `attachment` would drop it in
            // a downloads folder the person then has to go and find — the same reason
            // the single transfer's document is served inline. Their viewer has a save
            // button for the times saving is the point.
            'Content-Disposition': `inline; filename="${document.filename.replace(/["\\]/g, '')}"`,
            // Built fresh from transfers that can still be edited, so yesterday's copy
            // is not an answer to today's question.
            'Cache-Control': 'no-store',
        },
    });
}
