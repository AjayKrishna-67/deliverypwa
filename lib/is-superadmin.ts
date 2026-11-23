/**
 * SuperAdmin detection for UX gating only — the backend enforces the real gate
 * via @Allow(Permission.SuperAdmin). The current user's permissions live on
 * each channel membership; the SuperAdmin role carries the 'SuperAdmin'
 * permission on the default channel.
 *
 * The param types are kept minimal/structural (ChannelLike/CurrentUserLike) so
 * this helper stays decoupled from the generated `CurrentUser` type. The real
 * `currentUser.channels[].permissions` is `Permission[]` (a string enum), which
 * is assignable to `string[]`, so the real value can be passed directly.
 */
interface ChannelLike {
    code?: string;
    permissions?: string[];
}
interface CurrentUserLike {
    channels?: ChannelLike[];
}

const DEFAULT_CHANNEL_CODE = '__default_channel__';

export function isSuperadmin(currentUser: CurrentUserLike | null | undefined): boolean {
    if (!currentUser?.channels) {
        return false;
    }
    return currentUser.channels.some((c) => (c.permissions ?? []).includes('SuperAdmin'));
}

/**
 * UX gate for a single permission, scoped to the channel where the API call
 * actually runs. The price-matrix tool reads/writes catalog on the DEFAULT
 * channel, so its permission must be checked there too — checking the active
 * channel would not match the backend @Allow guard. SuperAdmin always passes.
 *
 * This is UX only; the backend @Allow on the resolver is the real enforcement.
 */
export function hasPermission(
    currentUser: CurrentUserLike | null | undefined,
    permission: string,
    channelCode: string = DEFAULT_CHANNEL_CODE,
): boolean {
    const channels = currentUser?.channels ?? [];
    const channel = channels.find((c) => c.code === channelCode);
    const permissions = channel?.permissions ?? [];
    return permissions.includes('SuperAdmin') || permissions.includes(permission);
}

/**
 * Channel-agnostic (global) UX gate: true if the user holds the permission on
 * ANY channel, or is SuperAdmin anywhere. Used by tools that scope data by
 * stock location + product tag rather than by channel (location-stock), so the
 * gate must not be tied to one channel. UX only — backend enforces the real
 * global gate (see assertGlobalPermissions).
 */
export function hasPermissionAnyChannel(
    currentUser: CurrentUserLike | null | undefined,
    permission: string,
): boolean {
    const channels = currentUser?.channels ?? [];
    return channels.some(
        (c) => (c.permissions ?? []).includes('SuperAdmin') || (c.permissions ?? []).includes(permission),
    );
}
