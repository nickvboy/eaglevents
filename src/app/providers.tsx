"use client";

import { SessionProvider } from "next-auth/react";

import { TRPCReactProvider } from "~/trpc/react";
import { ColorThemeProvider } from "./_components/theme/ColorThemeProvider";
import type { ResolvedPalette } from "~/server/services/theme";
import type { Session } from "next-auth";

export function Providers({
  children,
  palette,
  session,
}: {
  children: React.ReactNode;
  palette: ResolvedPalette;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <TRPCReactProvider>
        <ColorThemeProvider initialPalette={palette}>{children}</ColorThemeProvider>
      </TRPCReactProvider>
    </SessionProvider>
  );
}
