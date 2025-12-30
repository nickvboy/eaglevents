import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq, or } from "drizzle-orm";

const bodySchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email().max(255),
  password: z.string().min(8).max(255),
});

export async function POST(req: Request) {
  const json: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { username, email, password } = parsed.data;

  const emailLower = email.toLowerCase();

  const existing = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, emailLower)))
    .limit(1);

  if (existing[0]) {
    const taken =
      existing[0].username === username ? "username" : "email";
    return NextResponse.json(
      { error: `${taken} already in use` },
      { status: 409 },
    );
  }

  const hash = await bcrypt.hash(password, 10);

  await db.insert(users).values({
    username,
    email: emailLower,
    displayName: username,
    passwordHash: hash,
  });

  return NextResponse.json({ ok: true });
}
