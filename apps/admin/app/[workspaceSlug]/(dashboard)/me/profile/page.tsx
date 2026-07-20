"use client";

import { SettingsPage } from "@multica/views/settings";

export default function Page() {
  // SettingsPage reads `?tab=` from useSearchParams internally (TAB_QUERY_KEY = "tab").
  // Sidebar links to /me/profile?tab=profile to deep-link straight to the profile tab.
  return <SettingsPage />;
}
