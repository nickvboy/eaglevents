"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

const COMPLETED_MESSAGE = "Setup has already been completed";

export function useSetupCompletionRedirect() {
  const router = useRouter();

  return useCallback(
    (message?: string) => {
      if (message?.includes(COMPLETED_MESSAGE)) {
        router.replace("/");
        return true;
      }
      return false;
    },
    [router],
  );
}
