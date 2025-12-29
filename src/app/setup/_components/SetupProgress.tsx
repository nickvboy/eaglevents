"use client";

import type { SetupStatusData } from "~/types/setup";

type StepKey = "business" | "buildings" | "departments" | "users" | "theme" | "complete";

const labels: Record<StepKey, { title: string; description: string }> = {
  business: { title: "Business", description: "Name and organization type" },
  buildings: { title: "Buildings", description: "Facilities and rooms" },
  departments: { title: "Departments", description: "Departments and divisions" },
  users: { title: "Team accounts", description: "Admins, managers, employees" },
  theme: { title: "Theme", description: "Workspace palette" },
  complete: { title: "Finish", description: "Review and launch" },
};

const order: StepKey[] = ["business", "buildings", "departments", "users", "theme", "complete"];

export function SetupProgress({
  status,
  currentStep,
  onStepChange,
  maxUnlockedIndex,
  themeSelected,
}: {
  status: SetupStatusData;
  currentStep: StepKey;
  onStepChange: (step: StepKey) => void;
  maxUnlockedIndex: number;
  themeSelected: boolean;
}) {
  const completionMap: Record<StepKey, boolean> = {
    business: !!status.business,
    buildings: status.stepCompletion.buildings,
    departments: status.stepCompletion.departments,
    users: status.stepCompletion.users,
    theme: themeSelected,
    complete: status.readyForCompletion,
  };

  return (
    <div className="rounded-lg border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
      <h1 className="text-2xl font-semibold">Initial setup</h1>
      <p className="mt-1 text-sm text-ink-muted">Complete each step to unlock the platform.</p>
      <div className="mt-6 space-y-4">
        {order.map((step) => {
          const meta = labels[step];
          const completed = completionMap[step];
          const active = currentStep === step;
          const disabled = order.indexOf(step) > maxUnlockedIndex;
          const statusLabel =
            step === "theme" && !completed
              ? "Optional"
              : completed
                ? "Done"
                : active
                  ? "In progress"
                  : "Pending";
          return (
            <button
              key={step}
              type="button"
              onClick={() => onStepChange(step)}
              disabled={disabled}
              className={`w-full rounded-md border px-4 py-3 text-left transition ${
                active
                  ? "border-outline-accent bg-accent-muted/40"
                  : "border-outline-muted hover:border-outline-strong disabled:border-outline-muted/40 disabled:opacity-40"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{meta.title}</div>
                  <div className="text-xs text-ink-muted">{meta.description}</div>
                </div>
                <div
                  className={`text-xs font-semibold ${
                    completed ? "text-status-success" : active ? "text-ink-primary" : "text-ink-subtle"
                  }`}
                >
                  {statusLabel}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {status.missingAdmins.length > 0 ? (
        <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          <div className="font-semibold">Admins required</div>
          <ul className="mt-2 space-y-1">
            {status.missingAdmins.map((scope) => (
              <li key={`${scope.scopeType}-${scope.scopeId}`} className="flex items-center gap-2">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
                {scope.label} ({scope.scopeType})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
