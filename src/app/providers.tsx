"use client";

import { SessionProvider } from "next-auth/react";

import { TRPCReactProvider } from "~/trpc/react";
import { ColorThemeProvider } from "./_components/theme/ColorThemeProvider";
import type { ResolvedPalette } from "~/server/services/theme";

export function Providers({ children, palette }: { children: React.ReactNode; palette: ResolvedPalette }) {
  return (
    <SessionProvider>
      <TRPCReactProvider>
        <ColorThemeProvider initialPalette={palette}>{children}</ColorThemeProvider>
      </TRPCReactProvider>
    </SessionProvider>
  );
}
