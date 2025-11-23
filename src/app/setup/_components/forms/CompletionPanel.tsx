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
        <h2 className="text-xl font-semibold text-ink-primary">Review and launch</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Once complete, everyone can sign in and start scheduling with your organizational structure.
        </p>
      </div>
      <div className="rounded-md border border-outline-muted bg-surface-raised p-4 shadow-[var(--shadow-pane)]">
        <ul className="space-y-2 text-sm">
          {summaries.map((item) => (
            <li key={item.label} className="flex items-center justify-between">
              <span className="text-ink-primary">{item.label}</span>
              <span className={item.complete ? "text-status-success" : "text-ink-subtle"}>{item.complete ? "Ready" : "Missing"}</span>
            </li>
          ))}
        </ul>
        {status.missingAdmins.length > 0 ? (
          <div className="mt-3 text-xs text-status-warning">
            Add admins for:
            <ul className="mt-1 list-disc pl-5">
              {status.missingAdmins.map((scope) => (
                <li key={`${scope.scopeType}-${scope.scopeId}`}>{scope.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {completionError ? <p className="text-sm text-status-danger">{completionError}</p> : null}
      <button
        type="button"
        onClick={onComplete}
        disabled={!status.readyForCompletion || completing}
        className="rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default disabled:cursor-not-allowed disabled:opacity-60"
      >
        {completing ? "Finalizing..." : status.readyForCompletion ? "Complete setup" : "Awaiting previous steps"}
      </button>
      {!status.readyForCompletion ? (
        <p className="text-xs text-ink-muted">Finish earlier steps before launching the workspace.</p>
      ) : null}
    </div>
  );
}
