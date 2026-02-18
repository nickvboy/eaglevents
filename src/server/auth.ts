import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import bcrypt from "bcryptjs";
import { env } from "~/env";
import { getClientIp, loginLimiter } from "~/server/rate-limit";
import { authCookieNames } from "~/config/app";

const credentialsSchema = z.object({
  identifier: z.string().min(1, "Required"), // username or email
  password: z.string().min(1, "Required"),
});

function resolveBaseUrl(baseUrl: string) {
  const explicit =
    env.NODE_ENV === "production"
      ? env.DEV_SERVER_PROD ?? process.env.NEXTAUTH_URL ?? env.DEV_SERVER
      : env.DEV_SERVER ?? process.env.NEXTAUTH_URL;
  return explicit ?? baseUrl;
}

const resolvedBaseUrl = resolveBaseUrl("http://localhost:3000");
const useSecureCookies = env.NODE_ENV === "production" && resolvedBaseUrl.startsWith("https://");

export const authOptions: NextAuthOptions = {
  secret: env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: authCookieNames.sessionToken(useSecureCookies),
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: authCookieNames.csrfToken,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    nonce: {
      name: authCookieNames.nonce,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    state: {
      name: authCookieNames.state,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    pkceCodeVerifier: {
      name: authCookieNames.pkceCodeVerifier,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: authCookieNames.callbackUrl,
      options: { sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        identifier: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw, req) => {
        if (req?.headers) {
          const headers = new Headers(req.headers as HeadersInit);
          const ip = getClientIp(headers);
          const rateLimit = loginLimiter.check(ip);
          if (!rateLimit.success) {
            console.warn(`Rate limit exceeded for IP: ${ip}`);
            throw new Error(`RateLimit:${rateLimit.resetAt ?? Date.now()}`);
          }
        }

        const parsed = credentialsSchema.safeParse(raw ?? {});
        if (!parsed.success) return null;
        const { identifier, password } = parsed.data;

        const isEmail = identifier.includes("@");

        const rows = await db
          .select()
          .from(users)
          .where(
            isEmail
              ? eq(users.email, identifier.toLowerCase())
              : eq(users.username, identifier)
          )
          .limit(1);

        const user = rows[0];
        const dummyHash = "$2b$10$eV8z6zkkBOi9LzmHtW9.cOoZKjheUBdLPUi03Kmt/2Tl5ilgn7tz6";
        const hashToCompare = user?.passwordHash ?? dummyHash;

        const ok = await bcrypt.compare(password, hashToCompare);
        if (!user || !user.isActive || !ok) return null;

        return {
          id: String(user.id),
          name: user.username,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const userId = typeof user.id === "string" ? user.id : String(user.id);
        token.id = userId;
        token.name = user.name;
        token.email = user.email;
        const parsedId = Number.parseInt(userId, 10);
        if (Number.isInteger(parsedId)) {
          const profile = await db.query.profiles.findFirst({
            where: (p, { eq }) => eq(p.userId, parsedId),
            columns: { firstName: true },
          });
          const trimmedFirstName = profile?.firstName?.trim();
          token.profileFirstName = trimmedFirstName && trimmedFirstName.length > 0 ? trimmedFirstName : null;
        } else {
          token.profileFirstName = null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        if (token.id) {
          session.user.id = token.id;
        }
        session.user.name = token.name;
        session.user.email = typeof token.email === "string" ? token.email : null;
        session.user.profileFirstName = token.profileFirstName ?? null;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      const targetBase = resolveBaseUrl(baseUrl);
      try {
        const u = new URL(url, targetBase);
        // Only allow same-origin redirects; otherwise go home
        if (u.origin === targetBase) return u.toString();
        if (u.origin === "null" && url.startsWith("/")) return `${targetBase}${url}`;
        return targetBase;
      } catch {
        if (url.startsWith("/")) return `${targetBase}${url}`;
        return targetBase;
      }
    },
  },
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string | null | undefined;
      email: string | null | undefined;
      profileFirstName?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    profileFirstName?: string | null;
  }
}
