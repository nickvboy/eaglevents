"use client";

import { SessionProvider } from "next-auth/react";

import { TRPCReactProvider } from "~/trpc/react";
import { ColorThemeProvider } from "./_components/theme/ColorThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TRPCReactProvider>
        <ColorThemeProvider>{children}</ColorThemeProvider>
      </TRPCReactProvider>
    </SessionProvider>
  );
}
