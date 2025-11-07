"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { api } from "~/trpc/react";
import type { SetupStatusData } from "~/types/setup";
import { SetupProgress } from "./SetupProgress";
import { BusinessInfoForm } from "./forms/BusinessInfoForm";
import { BuildingsForm } from "./forms/BuildingsForm";
import { DepartmentsForm } from "./forms/DepartmentsForm";
import { UserAccountsForm } from "./forms/UserAccountsForm";
import { CompletionPanel } from "./forms/CompletionPanel";

type StepKey = "business" | "buildings" | "departments" | "users" | "complete";

const orderedSteps: StepKey[] = ["business", "buildings", "departments", "users", "complete"];

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

  const statusQuery = api.setup.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const { data: status, isLoading, refetch, error } = statusQuery;

  useEffect(() => {
    if (!status) return;
    if (!status.needsSetup) {
      router.replace("/");
      return;
    }
    setActiveStep((current) => {
      const recommended = deriveStep(status);
      const currentIndex = orderedSteps.indexOf(current);
      const recommendedIndex = orderedSteps.indexOf(recommended);
      return currentIndex <= recommendedIndex ? recommended : current;
    });
  }, [status, router]);

  const completeMutation = api.setup.completeSetup.useMutation({
    onSuccess: () => {
      void refetch();
    },
  });

  const handleCompleteSetup = async () => {
    if (completeMutation.isPending || !status) return;
    try {
      await completeMutation.mutateAsync();
    } catch {
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
          />
        );
        break;
      case "complete":
        stepContent = (
          <CompletionPanel
            status={status}
            onComplete={handleCompleteSetup}
            completing={completeMutation.isPending}
            completionError={completeMutation.error?.message ?? null}
          />
        );
        break;
      default:
        stepContent = null;
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="w-full max-w-md rounded-lg border border-white/10 bg-black/50 p-6 text-center">
          <h1 className="text-xl font-semibold">Unable to load setup status</h1>
          <p className="mt-2 text-sm text-white/70">
            {error.message ?? "The server returned an unexpected error. Check the API logs and try again."}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (isLoading || !status) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-sm text-white/70">Loading setup data...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row">
        <div className="md:w-1/3">
          <SetupProgress
            status={status}
            currentStep={activeStep}
            onStepChange={(step) => {
              const recommended = deriveStep(status);
              const requestedIndex = orderedSteps.indexOf(step);
              const recommendedIndex = orderedSteps.indexOf(recommended);
              if (requestedIndex <= recommendedIndex) setActiveStep(step);
            }}
          />
        </div>
        <div className="md:w-2/3">
          <div className="rounded-lg border border-white/10 bg-black/40 p-6 shadow-xl">{stepContent}</div>
        </div>
      </div>
    </main>
  );
}
