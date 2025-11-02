import { getServerSession } from "next-auth";

import { HydrateClient } from "~/trpc/server";
import { CalendarShell } from "./calendar/_components/CalendarShell";
import { authOptions } from "~/server/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  return (
    <HydrateClient>
      <CalendarShell currentUser={session?.user ?? null} />
    </HydrateClient>
  );
}
