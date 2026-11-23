/**
 * Selected-channel resolution — the one rule, shared.
 *
 * The sidebar stores the user's chosen channel id in localStorage; everything
 * that runs outside DashboardLayout (the delivery page, the location provider's
 * heartbeat) derives the channel token with this same logic: saved id if it
 * still exists, otherwise the first non-default channel.
 */

interface ChannelLike {
    id: string;
    code: string;
    token: string;
}
interface CurrentUserLike {
    channels?: ChannelLike[];
}

export function getSelectedChannelToken(user: CurrentUserLike | null | undefined): string | null {
    const channels = user?.channels?.filter((c) => c.code !== '__default_channel__') ?? [];
    if (channels.length === 0) return null;
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected-channel-id') : null;
    return (channels.find((c) => c.id === savedId) ?? channels[0]).token ?? null;
}
