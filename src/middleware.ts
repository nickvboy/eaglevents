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

async function fetchSetupStatus(url: URL) {
  try {
    const response = await fetch(new URL("/api/setup/status", url), {
      headers: { "x-setup-check": "1" },
      cache: "no-store",
    });
    if (!response.ok) return { needsSetup: false };
    return (await response.json()) as { needsSetup: boolean };
  } catch {
    return { needsSetup: false };
  }
}

export default async function middleware(req: Request & { nextUrl: URL }) {
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

  const pathname = req.nextUrl.pathname;
  const isSetupRoute = pathname.startsWith("/setup");
  const isSetupApi = pathname.startsWith("/api/setup");
  const isTrpc = pathname.startsWith("/api/trpc");
  const isSignupApi = pathname.startsWith("/api/signup");
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/signup");
  
  // Allow TRPC setup procedures to always go through (needed to check setup status)
  // TRPC paths are like /api/trpc/setup.status or /api/trpc/setup.createBusiness
  const isSetupTrpc = isTrpc && pathname.includes("/setup.");

  if (isSetupApi || isSignupApi || isSetupTrpc) {
    return NextResponse.next();
  }

  const status = await fetchSetupStatus(req.nextUrl);

  if (status.needsSetup && !isSetupRoute && !pathname.startsWith("/api/")) {
    const url = new URL("/setup", req.url);
    return NextResponse.redirect(url);
  }

  if (!status.needsSetup && isSetupRoute) {
    const url = new URL("/", req.url);
    return NextResponse.redirect(url);
  }

  if (isSetupRoute || isAuthRoute || (isTrpc && status.needsSetup)) {
    return NextResponse.next();
  }

  // Delegate to NextAuth middleware for auth protection
  // @ts-expect-error - Next's Request types differ between edge/node
  return authMiddleware(req);
}

export const config = {
  matcher: [
    // Protect everything except public assets and Next internals
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
