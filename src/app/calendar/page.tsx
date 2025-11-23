import { getServerSession } from "next-auth";

import { HydrateClient } from "~/trpc/server";
import { authOptions } from "~/server/auth";
import { CalendarShell } from "./_components/CalendarShell";

export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  return (
    <HydrateClient>
      <CalendarShell currentUser={session?.user ?? null} />
    </HydrateClient>
  );
}
