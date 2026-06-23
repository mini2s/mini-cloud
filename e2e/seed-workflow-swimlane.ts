// Seed test fixture for workflow swimlane view feature.
//
// Provides pre-authenticated fixtures so individual tests only need to
// worry about their own data seeding, navigation, and assertions.
//
// - `seededApi` — TestApiClient with lifecycle management (auto-cleanup)
// - `slug`      — workspace slug for URL building (page is at dashboard
//                  after login, so tests navigate to their own target URL)
//
// Export: `test` (extended Playwright test) and `expect`.

import { test as baseTest, expect } from "@playwright/test";
import { loginAsDefault, createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

interface SwimlaneSeedFixtures {
  seededApi: TestApiClient;
  slug: string;
}

const test = baseTest.extend<SwimlaneSeedFixtures>({
  seededApi: async ({}, use) => {
    const api = await createTestApi();
    await use(api);
    await api.cleanup();
  },

  slug: async ({ page }, use) => {
    const s = await loginAsDefault(page);
    await use(s);
  },
});

export { test, expect };
