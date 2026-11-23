/**
 * Delivery-person detection — mirrors the backend's own definition.
 *
 * The Vendure plugin (DeliveryPartnerService.getDeliveryPersons) defines a
 * delivery person as an Administrator whose channel role grants BOTH custom
 * permissions — TransitionToOutForDelivery AND TransitionToDelivered — and
 * is not the super-admin role. Those are exactly the people offered in the
 * "Own Delivery Fleet" dropdown when fulfilling an order, so with this same
 * rule the compulsory GPS gate applies to whoever can be assigned a
 * delivery. No role-naming convention involved.
 *
 * UX gating only — the backend enforces the real permissions.
 */
interface ChannelLike {
    permissions?: string[];
}
interface CurrentUserLike {
    channels?: ChannelLike[];
}

export function isDeliveryPersonUser(user: CurrentUserLike | null | undefined): boolean {
    const channels = user?.channels ?? [];
    // SuperAdmin carries every permission — exclude before the pair check
    if (channels.some((c) => (c.permissions ?? []).includes('SuperAdmin'))) return false;
    return channels.some((c) => {
        const perms = c.permissions ?? [];
        return (
            perms.includes('TransitionToOutForDelivery') &&
            perms.includes('TransitionToDelivered')
        );
    });
}
