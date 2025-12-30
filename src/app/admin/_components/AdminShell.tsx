"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";

import { BarChartIcon, CopyIcon, HomeIcon, ReportIcon, SettingsIcon, UsersIcon } from "~/app/_components/icons";
import { api } from "~/trpc/react";

import { CompanyView } from "./CompanyView";
import { DashboardView } from "./DashboardView";
import { DatabaseView } from "./DatabaseView";
import { ImportExportView } from "./ImportExportView";
import { ReportsView } from "./ReportsView";
import { UsersView } from "./UsersView";

type TabKey = "dashboard" | "company" | "users" | "reports" | "importExport" | "database";

type TabDefinition = {
  id: TabKey;
  label: string;
  description: string;
  icon: (props: { className?: string }) => ReactElement;
  requiredCapability: "dashboard:view" | "company:manage" | "users:manage" | "reports:view" | "import_export:manage" | "database:manage";
};

const tabs: TabDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Monitor the health of the platform with live metrics.",
    icon: BarChartIcon,
    requiredCapability: "dashboard:view",
  },
  {
    id: "company",
    label: "Company",
    description: "Manage organization structure, locations, and departments.",
    icon: HomeIcon,
    requiredCapability: "company:manage",
  },
  {
    id: "users",
    label: "Users",
    description: "Review user accounts and keep profile details up to date.",
    icon: UsersIcon,
    requiredCapability: "users:manage",
  },
  {
    id: "reports",
    label: "Reports",
    description: "Build executive-ready reports for leadership review.",
    icon: ReportIcon,
    requiredCapability: "reports:view",
  },
  {
    id: "importExport",
    label: "Import/Export",
    description: "Capture snapshots of the full system state or restore prior backups.",
    icon: CopyIcon,
    requiredCapability: "import_export:manage",
  },
  {
    id: "database",
    label: "Database",
    description: "Manage database records and clean up operational data.",
    icon: SettingsIcon,
    requiredCapability: "database:manage",
  },
];

export function AdminShell() {
  const permissionsQuery = api.admin.permissions.useQuery();
  const capabilities = permissionsQuery.data?.capabilities ?? [];
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => capabilities.includes(tab.requiredCapability)),
    [capabilities],
  );
  const allowedTabIds = useMemo(() => new Set(visibleTabs.map((tab) => tab.id)), [visibleTabs]);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const activeDefinition = useMemo(() => visibleTabs.find((tab) => tab.id === activeTab), [activeTab, visibleTabs]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0]!.id);
    }
  }, [activeTab, visibleTabs]);

  return (
    <section className="flex min-h-screen flex-col gap-8 bg-surface-canvas px-8 py-10 text-ink-primary">
      {permissionsQuery.isLoading ? (
        <div className="rounded-2xl border border-outline-muted bg-surface-muted p-6 text-sm text-ink-muted">
          Loading admin access...
        </div>
      ) : null}
      {permissionsQuery.isError ? (
        <div className="rounded-2xl border border-status-danger bg-status-danger-surface p-6 text-sm text-status-danger">
          Unable to load admin access. Please sign in again.
        </div>
      ) : null}
      {!permissionsQuery.isLoading && visibleTabs.length === 0 ? (
        <div className="rounded-2xl border border-outline-muted bg-surface-muted p-6 text-sm text-ink-muted">
          You do not have access to the admin panel.
        </div>
      ) : null}
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.3em] text-accent-soft">Control Center</p>
          <h1 className="text-3xl font-semibold text-ink-primary">Admin Panel</h1>
          {activeDefinition ? (
            <p className="max-w-3xl text-sm text-ink-muted">{activeDefinition.description}</p>
          ) : null}
        </div>
      </header>

      <nav className="flex flex-wrap items-center gap-8 border-b border-outline-muted pb-1" role="tablist" aria-label="Admin sections">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${tab.id}-panel`}
              onClick={() => setActiveTab(tab.id)}
              className="group relative flex items-center gap-2 pb-3 text-sm font-medium text-ink-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-strong focus-visible:outline-offset-2 hover:text-ink-primary"
            >
              <Icon className={"h-4 w-4 transition " + (isActive ? "text-accent-soft" : "group-hover:text-ink-primary")} />
              <span className={isActive ? "text-ink-primary" : undefined}>{tab.label}</span>
              <span
                aria-hidden
                className={
                  "absolute inset-x-0 bottom-0 h-[3px] origin-center rounded-full transition " +
                  (isActive
                    ? "scale-100 bg-accent-strong shadow-[var(--shadow-accent-glow)]"
                    : "scale-0 bg-outline-muted group-hover:scale-100")
                }
              />
            </button>
          );
        })}
      </nav>

      <section className="flex-1" role="presentation">
        <div id="dashboard-panel" role="tabpanel" hidden={activeTab !== "dashboard"}>
          {allowedTabIds.has("dashboard") && activeTab === "dashboard" ? <DashboardView /> : null}
        </div>
        <div id="company-panel" role="tabpanel" hidden={activeTab !== "company"}>
          {allowedTabIds.has("company") && activeTab === "company" ? <CompanyView /> : null}
        </div>
        <div id="users-panel" role="tabpanel" hidden={activeTab !== "users"}>
          {allowedTabIds.has("users") && activeTab === "users" ? <UsersView /> : null}
        </div>
        <div id="reports-panel" role="tabpanel" hidden={activeTab !== "reports"}>
          {allowedTabIds.has("reports") && activeTab === "reports" ? <ReportsView /> : null}
        </div>
        <div id="importExport-panel" role="tabpanel" hidden={activeTab !== "importExport"}>
          {allowedTabIds.has("importExport") && activeTab === "importExport" ? <ImportExportView /> : null}
        </div>
        <div id="database-panel" role="tabpanel" hidden={activeTab !== "database"}>
          {allowedTabIds.has("database") && activeTab === "database" ? <DatabaseView /> : null}
        </div>
      </section>
    </section>
  );
}
