import { HydrateClient } from "~/trpc/server";
import { CalendarShell } from "./_components/CalendarShell";

export default async function CalendarPage() {
  return (
    <HydrateClient>
      <CalendarShell />
    </HydrateClient>
  );
}
