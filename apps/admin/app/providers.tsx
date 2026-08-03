"use client";

import { useMemo } from "react";
import { CoreProvider } from "@multica/core/platform";
import { createBrowserCookieLocaleAdapter } from "@multica/core/i18n/browser";
import type { LocaleResources, SupportedLocale } from "@multica/core/i18n";
import { useWelcomeStore } from "@multica/core/onboarding";
import packageJson from "../package.json";
import { AdminNavigationProvider } from "@/platform/navigation";
import { setLoggedInCookie, clearLoggedInCookie } from "@/features/auth/auth-cookie";

function hasLegacyToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem("multica_token"));
  } catch {
    return false;
  }
}

function deriveWsUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return undefined;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const apiPath = process.env.NEXT_PUBLIC_API_URL || "";
  const wsPath = apiPath && apiPath.startsWith("/") ? `${apiPath}/ws` : "/ws";
  return `${proto}//${window.location.host}${wsPath}`;
}

const ADMIN_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "dev";

export function AdminProviders({
  children,
  locale,
  resources,
}: {
  children: React.ReactNode;
  locale: SupportedLocale;
  resources: Record<string, LocaleResources>;
}) {
  const cookieAuth = !hasLegacyToken();
  const identity = useMemo(
    () => ({ platform: "admin" as const, version: ADMIN_VERSION }),
    [],
  );
  const localeAdapter = useMemo(() => createBrowserCookieLocaleAdapter(), []);
  return (
    <CoreProvider
      apiBaseUrl={process.env.NEXT_PUBLIC_API_URL}
      wsUrl={deriveWsUrl()}
      cookieAuth={cookieAuth}
      onLogin={setLoggedInCookie}
      onLogout={() => {
        useWelcomeStore.getState().reset();
        clearLoggedInCookie();
      }}
      identity={identity}
      locale={locale}
      resources={resources}
      localeAdapter={localeAdapter}
    >
      <AdminNavigationProvider>{children}</AdminNavigationProvider>
    </CoreProvider>
  );
}
