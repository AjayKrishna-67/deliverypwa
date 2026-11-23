/**
 * Channels service — fetches the list of Vendure channels.
 */

import { vendureFetch } from '@/graphql/client';
import { CHANNELS_QUERY } from '@/graphql/operations/channels';

// ─── Types ───────────────────────────────────────────────────────────

export interface ChannelItem {
    id: string;
    code: string;
    token: string;
    customFields?: {
        type?: string | null;
        enabled?: boolean | null;
        invoiceGroup?: string | null;
    } | null;
}

// ─── Service ─────────────────────────────────────────────────────────

export async function fetchChannels(): Promise<ChannelItem[]> {
    const { data } = await vendureFetch<{
        channels: { items: ChannelItem[]; totalItems: number };
    }>(CHANNELS_QUERY);
    return data.channels.items.filter((c) => c.code !== '__default_channel__');
}
