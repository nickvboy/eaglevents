import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { profiles } from "~/server/db/schema";
import { eq } from "drizzle-orm";

const bodySchema = z.object({
  firstName: z
    .string()
    .min(1, "First name required")
    .max(100, "First name too long")
    .transform((value) => value.trim()),
  lastName: z
    .string()
    .min(1, "Last name required")
    .max(100, "Last name too long")
    .transform((value) => value.trim()),
  email: z.string().email().max(255),
  phoneNumber: z.string().min(1),
  dateOfBirth: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value : undefined)),
});

function formatResponse(profile: {
  id: number;
  userId: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string | null;
}) {
  return {
    id: profile.id,
    userId: profile.userId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    phoneNumber: profile.phoneNumber,
    dateOfBirth: profile.dateOfBirth,
  };
}

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const userId = Number.parseInt(session.user.id, 10);
  if (!Number.isInteger(userId)) return null;
  return { session, userId };
}

export async function GET() {
  const auth = await requireSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.query.profiles.findFirst({
    where: (p, { eq }) => eq(p.userId, auth.userId),
  });

  if (!existing) {
    return NextResponse.json({ profile: null });
  }

  return NextResponse.json({ profile: formatResponse(existing) });
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const emailLower = parsed.data.email.toLowerCase();
  const digits = parsed.data.phoneNumber.replace(/\D/g, "").slice(0, 10);
  const firstName = parsed.data.firstName;
  const lastName = parsed.data.lastName;

  if (digits.length < 10) {
    return NextResponse.json(
      { error: "Phone number must include at least 10 digits" },
      { status: 400 },
    );
  }

  const dobString = parsed.data.dateOfBirth;
  let dateOfBirth: string | null = null;
  if (dobString) {
    const parsedDate = new Date(dobString);
    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date of birth" },
        { status: 400 },
      );
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsedDate > today) {
      return NextResponse.json(
        { error: "Date of birth cannot be in the future" },
        { status: 400 },
      );
    }
    dateOfBirth = dobString;
  }

  const existingForUser = await db.query.profiles.findFirst({
    where: (p, { eq }) => eq(p.userId, auth.userId),
  });

  const existingByEmail = await db.query.profiles.findFirst({
    where: (p, { eq }) => eq(p.email, emailLower),
  });

  if (
    existingByEmail &&
    existingByEmail.id !== (existingForUser?.id ?? null)
  ) {
    return NextResponse.json(
      { error: "Email already used by another profile" },
      { status: 409 },
    );
  }

  const now = new Date();

  if (existingForUser) {
    await db
      .update(profiles)
      .set({
        firstName,
        lastName,
        email: emailLower,
        phoneNumber: digits,
        dateOfBirth,
        updatedAt: now,
      })
      .where(eq(profiles.id, existingForUser.id));

    return NextResponse.json({
      ok: true,
      profile: formatResponse({
        ...existingForUser,
        firstName,
        lastName,
        email: emailLower,
        phoneNumber: digits,
        dateOfBirth,
      }),
    });
  }

  const inserted = await db
      .insert(profiles)
      .values({
        userId: auth.userId,
        firstName,
        lastName,
        email: emailLower,
        phoneNumber: digits,
        dateOfBirth,
        createdAt: now,
        updatedAt: now,
    })
    .returning();

  const profile = inserted[0];

  return NextResponse.json({
    ok: true,
    profile: profile ? formatResponse(profile) : null,
  });
}
