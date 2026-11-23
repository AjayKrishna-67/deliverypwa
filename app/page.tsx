'use client';

/**
 * Dashboard home page — authenticated landing view.
 * Wraps itself in DashboardLayout for the sidebar + header.
 */

import Link from 'next/link';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { canSeeGoodsTransfer } from '@/lib/goods-transfer-permissions';
import { useAuth } from '@/providers/AuthProvider';

export default function DashboardPage() {
  const { isLoading, isAuthenticated } = useRequireAuth();
  const { currentUser } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return null;

  return (
    <DashboardLayout>
      {() => (
        <main className="flex-1 flex items-start justify-start p-8 gap-4 flex-wrap">
          <Link
            href="/orders"
            className="flex flex-col items-center justify-center gap-3 w-[140px] h-[120px] rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] no-underline text-[var(--foreground)] transition-all duration-200 cursor-pointer hover:border-[var(--accent)] hover:bg-indigo-500/8 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            <span className="text-3xl">📦</span>
            <span className="text-[0.8125rem] font-semibold">Orders</span>
          </Link>
          <Link
            href="/reports"
            className="flex flex-col items-center justify-center gap-3 w-[140px] h-[120px] rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] no-underline text-[var(--foreground)] transition-all duration-200 cursor-pointer hover:border-[var(--accent)] hover:bg-indigo-500/8 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
          >
            <span className="text-3xl">📊</span>
            <span className="text-[0.8125rem] font-semibold">Reports</span>
          </Link>
          {/*
            Gated, unlike the two above.

            The Goods Transfer section redirects anyone without the permission straight
            back here, so an ungated card would be a tile that visibly does nothing —
            worst of all for delivery partners, who have no business there and would
            tap it first. The sidebar link uses this same check, so the two agree.
          */}
          {canSeeGoodsTransfer(currentUser) && (
            <Link
              href="/goods-transfer"
              className="flex flex-col items-center justify-center gap-3 w-[140px] h-[120px] rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] no-underline text-[var(--foreground)] transition-all duration-200 cursor-pointer hover:border-[var(--accent)] hover:bg-indigo-500/8 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
            >
              <span className="text-3xl">🚚</span>
              <span className="text-[0.8125rem] font-semibold text-center leading-tight">
                Goods
                <br />
                Transfer
              </span>
            </Link>
          )}
        </main>
      )}
    </DashboardLayout>
  );
}
