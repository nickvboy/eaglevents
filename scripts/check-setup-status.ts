import "dotenv/config";

import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

async function main() {
  const ctx = await createTRPCContext({ headers: new Headers(), session: null });
  const caller = createCaller(ctx);
  const status = await caller.setup.status();
  console.dir(status, { depth: null });
}

void main().catch((err) => {
  console.error("Failed to load setup status", err);
  process.exit(1);
});
