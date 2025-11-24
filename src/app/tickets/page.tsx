import { HydrateClient } from "~/trpc/server";

import { TicketsShell } from "./_components/TicketsShell";

export default async function TicketsPage() {
  return (
    <HydrateClient>
      <TicketsShell />
    </HydrateClient>
  );
}

