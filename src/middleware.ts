import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "~/config/app";

const authCallbacks = {
  authorized: ({ token }: { token?: unknown }) => !!token,
};

function resolveBaseUrl(baseUrl: string) {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (baseUrl) return baseUrl;
  if (process.env.NODE_ENV === "production") {
    return process.env.DEV_SERVER_PROD ?? process.env.DEV_SERVER ?? "http://localhost:3000";
  }
  return process.env.DEV_SERVER ?? "http://localhost:3000";
}

async function fetchSetupStatus(url: URL) {
  const statusBase = resolveBaseUrl(url.origin);
  const statusUrl = new URL("/api/setup/status", statusBase);
  try {
    const response = await fetch(statusUrl, {
      headers: { "x-setup-check": "1" },
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`[setup] status check failed: ${response.status} ${response.statusText} (${statusUrl.toString()})`);
      return { needsSetup: false, statusKnown: false };
    }
    const data = (await response.json()) as { needsSetup: boolean };
    return { ...data, statusKnown: true };
  } catch (error) {
    console.error(
      `[setup] status check threw for ${statusUrl.toString()}:`,
      error instanceof Error ? error.message : error,
    );
    return { needsSetup: false, statusKnown: false };
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

  if (isSetupApi || isSetupTrpc) {
    return NextResponse.next();
  }

  const status = await fetchSetupStatus(req.nextUrl);

  if (status.statusKnown && status.needsSetup && isSignupApi) {
    return NextResponse.json(
      { error: "Signup is disabled until setup is complete." },
      { status: 403 },
    );
  }
  if (isSignupApi) {
    return NextResponse.next();
  }

  if (status.statusKnown && status.needsSetup && !isSetupRoute && !pathname.startsWith("/api/")) {
    const url = new URL("/setup", req.url);
    return NextResponse.redirect(url);
  }

  if (status.statusKnown && status.needsSetup && isAuthRoute) {
    const url = new URL("/setup", req.url);
    return NextResponse.redirect(url);
  }

  if (status.statusKnown && !status.needsSetup && isSetupRoute) {
    const url = new URL("/", req.url);
    return NextResponse.redirect(url);
  }

  if (isSetupRoute || isAuthRoute || (isTrpc && status.statusKnown && status.needsSetup)) {
    return NextResponse.next();
  }

  const resolvedBaseUrl = resolveBaseUrl(req.nextUrl.origin);
  const useSecureCookies =
    process.env.NODE_ENV === "production" && resolvedBaseUrl.startsWith("https://");
  const authMiddleware = withAuth({
    callbacks: authCallbacks,
    // Keep cookie names unique to this app to avoid conflicts with other localhost apps
    cookies: {
      sessionToken: {
        name: getSessionCookieName(useSecureCookies),
      },
    },
  });

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
