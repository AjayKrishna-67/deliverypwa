'use client';

/**
 * The Goods Transfer section.
 *
 * A layout rather than a wrapper inside each page, so the shell — the permission
 * gate, the branch resolution, the alert poll and the toast host — is mounted once
 * and survives navigation between these routes. With a copy in every page, moving
 * from the list to a transfer tore all of that down and rebuilt it, and every
 * navigation paid for a fresh round of requests asking what had not changed.
 */

import type { ReactNode } from 'react';

import { GoodsTransferShell } from '@/components/goods-transfer/GoodsTransferShell';

export default function GoodsTransferLayout({ children }: { children: ReactNode }) {
    return <GoodsTransferShell>{children}</GoodsTransferShell>;
}
