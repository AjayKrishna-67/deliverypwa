/**
 * What this person may do in Goods Transfer, on the branch they are acting as.
 *
 * This is the SECOND check, never the only one. The server refuses anything the role
 * does not allow regardless of what the screen shows; hiding a button here only
 * spares someone from pressing something that was always going to fail.
 *
 * Permissions are PER BRANCH, which is why the branch matters and not just the
 * account: the same person can be allowed to raise a transfer in Madurai and allowed
 * only to receive one in Idukki. DashboardLayout already resolves the selected
 * branch's permission list — pass that straight in.
 *
 * These permission names are declared by the backend Goods Transfer plugin. On a
 * server where that plugin is not installed they do not exist, so no role can hold
 * them and every gate here closes on its own. That is what makes this section safe
 * to ship before the backend is deployed.
 */

import { hasPermissionAnyChannel } from '@/lib/is-superadmin';

export const GT_PERMISSION = {
    read: 'ReadGoodsTransfer',
    create: 'CreateGoodsTransfer',
    update: 'UpdateGoodsTransfer',
    delete: 'DeleteGoodsTransfer',
    receive: 'ApproveGoodsTransferReceipt',
    raiseDamage: 'RecordTransferDamage',
    approveDamage: 'ApproveTransferDamage',
    reports: 'ViewTransferReports',
} as const;

const SUPER_ADMIN = 'SuperAdmin';

export interface Can {
    read: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    receive: boolean;
    /**
     * May ASK another branch to send goods.
     *
     * Deliberately create OR receipt, which is what the server allows. Asking is a
     * receiving-side act, and the roles split on exactly that line: a Receiving
     * Manager holds Read plus the receipt permission and no Create at all. Gating this
     * on Create would put the request behind a permission belonging to the branch that
     * SENDS — so the branches that actually run short could not ask.
     */
    request: boolean;
    raiseDamage: boolean;
    approveDamage: boolean;
    /** Anything at all — false means this branch has no Goods Transfer access. */
    anything: boolean;
}

const NOTHING: Can = {
    read: false,
    create: false,
    update: false,
    delete: false,
    receive: false,
    request: false,
    raiseDamage: false,
    approveDamage: false,
    anything: false,
};

/**
 * Reads the permission list the SERVER returned for the selected branch.
 *
 * Nothing is inferred from the account name, and no permission is treated as
 * implying another — "can create" does not quietly grant "can dispatch".
 */
export function permissionsFor(channelPermissions: string[] | null | undefined): Can {
    if (!channelPermissions?.length) {
        return NOTHING;
    }
    const held = new Set(channelPermissions);
    const has = (p: string) => held.has(p) || held.has(SUPER_ADMIN);

    const can: Can = {
        read: has(GT_PERMISSION.read) || has(GT_PERMISSION.reports),
        create: has(GT_PERMISSION.create),
        update: has(GT_PERMISSION.update),
        delete: has(GT_PERMISSION.delete),
        receive: has(GT_PERMISSION.receive),
        request: has(GT_PERMISSION.create) || has(GT_PERMISSION.receive),
        raiseDamage: has(GT_PERMISSION.raiseDamage),
        approveDamage: has(GT_PERMISSION.approveDamage),
        anything: false,
    };
    can.anything = Object.entries(can).some(([key, value]) => key !== 'anything' && value);
    return can;
}

/**
 * Whether the Goods Transfer section is offered at all — the sidebar's gate.
 *
 * Deliberately channel-AGNOSTIC: a person allowed to receive transfers in Idukki
 * should still see the section while standing in Madurai, otherwise the link
 * disappears when they switch branch and the way back is not obvious. The page
 * itself re-checks per branch and says plainly when the selected one has no access.
 *
 * Delegates to the dashboard's existing helper rather than reading `channels`
 * again — that helper already handles SuperAdmin.
 */
export function canSeeGoodsTransfer(
    currentUser: { channels?: Array<{ code?: string; permissions?: string[] }> } | null | undefined,
): boolean {
    return (
        hasPermissionAnyChannel(currentUser, GT_PERMISSION.read) ||
        hasPermissionAnyChannel(currentUser, GT_PERMISSION.reports)
    );
}
