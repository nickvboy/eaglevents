import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { getSetupStatus } from "~/server/services/setup";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getSetupStatus(db);
  return NextResponse.json({ needsSetup: status.needsSetup, readyForCompletion: status.readyForCompletion });
}
