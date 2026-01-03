import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { getSetupStatus } from "~/server/services/setup";
import { SetupWizard } from "./_components/SetupWizard";

export default async function SetupPage() {
  const status = await getSetupStatus(db);
  if (!status.needsSetup) {
    redirect("/");
  }
  return <SetupWizard />;
}
