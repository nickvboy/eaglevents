import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const authMiddleware = withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
  // Keep cookie names unique to this app to avoid conflicts with other localhost apps
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-t3app.session-token"
          : "t3app.session-token",
    },
  },
});

export default function middleware(req: Request & { nextUrl: URL }) {
  // Sanitize any cross-origin callbackUrl in query string to avoid leaking to other localhost apps
  try {
    const url = new URL(req.url);
    const cb = url.searchParams.get("callbackUrl");
    if (cb) {
      const parsed = new URL(cb, url.origin);
      if (parsed.origin !== url.origin) {
        url.searchParams.set("callbackUrl", "/");
        return NextResponse.redirect(url);
      }
    }
  } catch {
    // ignore
  }

  // Delegate to NextAuth middleware for auth protection
  // @ts-expect-error - Next's Request types differ between edge/node
  return authMiddleware(req);
}

export const config = {
  matcher: [
    // Protect everything except public assets, Next internals, login, and auth endpoints
    "/((?!api/auth|api/signup|login|signup|_next/static|_next/image|favicon.ico).*)",
  ],
};
