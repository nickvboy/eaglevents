import { HydrateClient } from "~/trpc/server";
import { CalendarShell } from "./calendar/_components/CalendarShell";

export default async function Home() {
  return (
    <HydrateClient>
      <CalendarShell />
    </HydrateClient>
  );
}
