import { HydrateClient } from "~/trpc/server";

import { AdminShell } from "./_components/AdminShell";

export default function AdminPage() {
  return (
    <HydrateClient>
      <AdminShell />
    </HydrateClient>
  );
}

