"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { api, type RouterOutputs } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";
import { SetupProgress } from "./SetupProgress";
import { BusinessInfoForm } from "./forms/BusinessInfoForm";
import { BuildingsForm } from "./forms/BuildingsForm";
import { DepartmentsForm } from "./forms/DepartmentsForm";
import { UserAccountsForm } from "./forms/UserAccountsForm";
import { CompletionPanel } from "./forms/CompletionPanel";
import { ThemeForm } from "./forms/ThemeForm";
import { formatGeneratedCredentials } from "./forms/credentialsExport";

type StepKey = "business" | "buildings" | "departments" | "users" | "theme" | "complete";
type GeneratedDefaultUser = RouterOutputs["setup"]["createDefaultUsers"]["generatedUsers"][number];

const orderedSteps: StepKey[] = ["business", "buildings", "departments", "users", "theme", "complete"];

function deriveStep(status: SetupStatusData | undefined): StepKey {
  if (!status) return "business";
  if (!status.business) return "business";
  if (!status.stepCompletion.buildings) return "buildings";
  if (!status.stepCompletion.departments) return "departments";
  if (!status.stepCompletion.users) return "users";
  return "complete";
}

export function SetupWizard() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<StepKey>("business");
  const [postSetupCredential, setPostSetupCredential] = useState<{ identifier: string; password: string } | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [themeSelection, setThemeSelection] = useState<{ paletteId: number | null; paletteName: string | null } | null>(null);
  const [generatedDefaults, setGeneratedDefaults] = useState<GeneratedDefaultUser[]>([]);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const statusQuery = api.setup.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: status, isLoading, refetch, error } = statusQuery;

  useEffect(() => {
    if (!status) return;
    if (!status.needsSetup) {
      router.replace("/");
      return;
    }
    const recommended = deriveStep(status);
    setActiveStep((current) => {
      const currentIndex = orderedSteps.indexOf(current);
      const recommendedIndex = orderedSteps.indexOf(recommended);
      if (!hasInitialized) return recommended;
      return currentIndex > recommendedIndex ? recommended : current;
    });
    if (!hasInitialized) setHasInitialized(true);
  }, [status, router, hasInitialized]);

  const completeMutation = api.setup.completeSetup.useMutation({
    onSuccess: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const credentialsExport = useMemo(
    () => (generatedDefaults.length > 0 ? formatGeneratedCredentials(generatedDefaults) : ""),
    [generatedDefaults],
  );

  const handleCopyCredentials = async () => {
    if (!credentialsExport) return;
    try {
      await navigator.clipboard.writeText(credentialsExport);
      setCopyStatus("Copied credentials to clipboard");
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : "Unable to copy credentials");
    }
  };

  const handleCompleteSetup = async () => {
    if (completeMutation.isPending || !status) return;
    try {
      await completeMutation.mutateAsync({
        paletteId: themeSelection?.paletteId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Setup has already been completed")) {
        router.replace("/");
        return;
      }
      return;
    }
    if (postSetupCredential) {
      await signIn("credentials", {
        redirect: false,
        identifier: postSetupCredential.identifier,
        password: postSetupCredential.password,
        callbackUrl: "/",
      });
    }
    router.replace("/");
  };

  let stepContent = null;
  if (status) {
    switch (activeStep) {
      case "business":
        stepContent = <BusinessInfoForm status={status} onUpdated={() => refetch()} />;
        break;
      case "buildings":
        stepContent = <BuildingsForm status={status} onUpdated={() => refetch()} />;
        break;
      case "departments":
        stepContent = <DepartmentsForm status={status} onUpdated={() => refetch()} />;
        break;
      case "users":
        stepContent = (
          <UserAccountsForm
            status={status}
            onUpdated={() => refetch()}
            onRememberCredential={setPostSetupCredential}
            rememberedCredential={postSetupCredential}
            generatedDefaults={generatedDefaults}
            onGeneratedDefaultsChange={setGeneratedDefaults}
          />
        );
        break;
      case "theme":
        stepContent = <ThemeForm onSelectionChange={setThemeSelection} />;
        break;
      case "complete":
        stepContent = (
          <CompletionPanel
            status={status}
            onComplete={handleCompleteSetup}
            completing={completeMutation.isPending}
            completionError={completeMutation.error?.message ?? null}
            themeSelection={themeSelection}
          />
        );
        break;
      default:
        stepContent = null;
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
        <div className="w-full max-w-md rounded-lg border border-outline-muted bg-surface-raised p-6 text-center shadow-[var(--shadow-pane)]">
          <h1 className="text-xl font-semibold">Unable to load setup status</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {error.message ?? "The server returned an unexpected error. Check the API logs and try again."}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-accent-strong px-4 py-2 text-sm font-semibold text-ink-inverted transition hover:bg-accent-default"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (isLoading || !status) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-canvas text-ink-primary">
        <div className="text-sm text-ink-muted">Loading setup data...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-canvas text-ink-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row">
        <div className="md:w-1/3">
          <SetupProgress
            status={status}
            currentStep={activeStep}
            maxUnlockedIndex={orderedSteps.indexOf(deriveStep(status))}
            onStepChange={(step) => {
              const maxIndex = orderedSteps.indexOf(deriveStep(status));
              const requestedIndex = orderedSteps.indexOf(step);
              if (requestedIndex <= maxIndex) setActiveStep(step);
            }}
            themeSelected={themeSelection !== null}
          />
        </div>
        <div className="md:w-2/3">
          <div className="rounded-lg border border-outline-muted bg-surface-raised p-6 shadow-[var(--shadow-pane)]">
            {stepContent}
          </div>
          {generatedDefaults.length > 0 && activeStep !== "users" ? (
            <div className="mt-4 rounded-lg border border-outline-muted bg-surface-muted p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase text-ink-subtle">Generated account credentials</div>
                  <p className="mt-1 text-xs text-ink-muted">Save these usernames and passwords in a secure place.</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCredentials}
                  className="inline-flex items-center gap-2 rounded-full border border-outline-accent bg-accent-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-primary shadow-[var(--shadow-button)] transition hover:border-outline-strong hover:bg-accent-muted"
                >
                  <span aria-hidden="true">⧉</span>
                  Copy credentials
                </button>
              </div>
              {copyStatus ? <p className="mt-2 text-xs text-ink-muted">{copyStatus}</p> : null}
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 font-mono text-[11px] text-ink-muted">
                {generatedDefaults.map((user) => (
                  <div key={`${user.username}-${user.roleType}`} className="rounded border border-outline-muted bg-surface-raised p-2">
                    <div className="text-ink-primary">{user.scopeLabel}</div>
                    <div>username: {user.username}</div>
                    <div>password: {user.password}</div>
                    <div>email: {user.email}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
