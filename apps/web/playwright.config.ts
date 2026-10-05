import { defineConfig } from "@playwright/test"

export const PORT = 4317

// One worker: the tests share one seeded database and each one owns its own items.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    // Local runs use the installed Chrome; CI installs Playwright's Chromium.
    channel: process.env.CI ? undefined : "chrome",
  },
  webServer: {
    command: "bun run build && bun e2e/serve.ts",
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT) },
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
