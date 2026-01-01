import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import bcrypt from "bcryptjs";
import { env } from "~/env";
import { getClientIp, loginLimiter } from "~/server/rate-limit";

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
      name:
        useSecureCookies
          ? "__Secure-t3app.session-token"
          : "t3app.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: "t3app.csrf-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    nonce: {
      name: "t3app.nonce",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    state: {
      name: "t3app.state",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    pkceCodeVerifier: {
      name: "t3app.pkce",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: "t3app.callback-url",
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
        if (!user) return null;
        if (!user.isActive) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

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
        token.id = typeof user.id === "string" ? user.id : String(user.id);
        token.name = user.name;
        token.email = user.email;
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
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
