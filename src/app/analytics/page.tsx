import { HydrateClient } from "~/trpc/server";

import { AnalyticsShell } from "./_components/AnalyticsShell";

export default function AnalyticsPage() {
  return (
    <HydrateClient>
      <AnalyticsShell />
    </HydrateClient>
  );
}
