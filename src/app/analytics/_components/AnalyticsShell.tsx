"use client";

import { AnalyticsView } from "~/app/admin/_components/AnalyticsView";
import { api } from "~/trpc/react";

export function AnalyticsShell() {
  const permissionsQuery = api.admin.permissions.useQuery();
  const canAccessAnalytics = permissionsQuery.data?.capabilities.includes("analytics:view") ?? false;

  return (
    <section className="flex min-h-screen flex-col gap-8 bg-surface-canvas px-8 py-10 text-ink-primary">
      {permissionsQuery.isLoading ? (
        <div className="rounded-2xl border border-outline-muted bg-surface-muted p-6 text-sm text-ink-muted">
          Loading analytics access...
        </div>
      ) : null}
      {permissionsQuery.isError ? (
        <div className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
          Unable to load analytics access. Please sign in again.
        </div>
      ) : null}
      {!permissionsQuery.isLoading && !permissionsQuery.isError && !canAccessAnalytics ? (
        <div className="rounded-2xl border border-outline-muted bg-surface-muted p-6 text-sm text-ink-muted">
          You do not have access to analytics.
        </div>
      ) : null}
      {canAccessAnalytics ? <AnalyticsView /> : null}
    </section>
  );
}
