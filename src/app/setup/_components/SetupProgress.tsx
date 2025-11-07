"use client";

import type { SetupStatusData } from "~/types/setup";

type StepKey = "business" | "buildings" | "departments" | "users" | "complete";

const labels: Record<StepKey, { title: string; description: string }> = {
  business: { title: "Business", description: "Name and organization type" },
  buildings: { title: "Buildings", description: "Facilities and rooms" },
  departments: { title: "Departments", description: "Departments and divisions" },
  users: { title: "Team accounts", description: "Admins, managers, employees" },
  complete: { title: "Finish", description: "Review and launch" },
};

const order: StepKey[] = ["business", "buildings", "departments", "users", "complete"];

export function SetupProgress({
  status,
  currentStep,
  onStepChange,
}: {
  status: SetupStatusData;
  currentStep: StepKey;
  onStepChange: (step: StepKey) => void;
}) {
  const completionMap: Record<StepKey, boolean> = {
    business: !!status.business,
    buildings: status.stepCompletion.buildings,
    departments: status.stepCompletion.departments,
    users: status.stepCompletion.users,
    complete: status.readyForCompletion,
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-6 shadow-lg">
      <h1 className="text-2xl font-semibold">Initial setup</h1>
      <p className="mt-1 text-sm text-white/60">Complete each step to unlock the platform.</p>
      <div className="mt-6 space-y-4">
        {order.map((step) => {
          const meta = labels[step];
          const completed = completionMap[step];
          const active = currentStep === step;
          const disabled = !completed && order.indexOf(step) > order.indexOf(currentStep);
          return (
            <button
              key={step}
              type="button"
              onClick={() => onStepChange(step)}
              disabled={disabled}
              className={`w-full rounded-md border px-4 py-3 text-left transition ${
                active
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-white/10 hover:border-white/30 disabled:border-white/5 disabled:opacity-40"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{meta.title}</div>
                  <div className="text-xs text-white/60">{meta.description}</div>
                </div>
                <div
                  className={`text-xs font-semibold ${
                    completed ? "text-emerald-400" : active ? "text-white" : "text-white/50"
                  }`}
                >
                  {completed ? "Done" : active ? "In progress" : "Pending"}
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
