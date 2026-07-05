import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 5 (roadmap_to_A_grade) — visual-regression config. Drives the rendered
 * /mock fixture surface (and, later, live sweep-response fixtures) at desktop +
 * mobile. Reuses an already-running dev server (:3000); starts one if absent.
 */
export default defineConfig({
  testDir: "./tests/visual",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/visual",
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 380, height: 780 } } },
  ],
});
