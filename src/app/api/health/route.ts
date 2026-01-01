import { NextResponse } from "next/server";

import { checkDatabaseHealth } from "~/server/db/health";

export async function GET() {
  const health = await checkDatabaseHealth();

  if (!health.healthy) {
    return NextResponse.json(
      { status: "unhealthy", error: health.error },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: "healthy",
    database: {
      connected: true,
      latencyMs: health.latencyMs,
    },
  });
}
