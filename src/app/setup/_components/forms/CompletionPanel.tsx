"use client";

import type { SetupStatusData } from "~/types/setup";

export function CompletionPanel({
  status,
  onComplete,
  completing,
  completionError,
}: {
  status: SetupStatusData;
  onComplete: () => void;
  completing: boolean;
  completionError: string | null;
}) {
  const summaries = [
    { label: "Business", complete: !!status.business },
    { label: "Buildings", complete: status.stepCompletion.buildings },
    { label: "Departments", complete: status.stepCompletion.departments },
    { label: "Team accounts", complete: status.stepCompletion.users },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review and launch</h2>
        <p className="mt-1 text-sm text-white/60">
          Once complete, everyone can sign in and start scheduling with your organizational structure.
        </p>
      </div>
      <div className="rounded-md border border-white/10 bg-black/60 p-4">
        <ul className="space-y-2 text-sm">
          {summaries.map((item) => (
            <li key={item.label} className="flex items-center justify-between">
              <span>{item.label}</span>
              <span className={item.complete ? "text-emerald-300" : "text-white/50"}>{item.complete ? "Ready" : "Missing"}</span>
            </li>
          ))}
        </ul>
        {status.missingAdmins.length > 0 ? (
          <div className="mt-3 text-xs text-amber-200">
            Add admins for:
            <ul className="mt-1 list-disc pl-5">
              {status.missingAdmins.map((scope) => (
                <li key={`${scope.scopeType}-${scope.scopeId}`}>{scope.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {completionError ? <p className="text-sm text-red-300">{completionError}</p> : null}
      <button
        type="button"
        onClick={onComplete}
        disabled={!status.readyForCompletion || completing}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {completing ? "Finalizing..." : status.readyForCompletion ? "Complete setup" : "Awaiting previous steps"}
      </button>
      {!status.readyForCompletion ? (
        <p className="text-xs text-white/60">Finish earlier steps before launching the workspace.</p>
      ) : null}
    </div>
  );
}
