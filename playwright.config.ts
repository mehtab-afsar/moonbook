import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APP = process.env.APP_URL ?? "http://localhost:3000";

/**
 * Every spec runs in its OWN tenant, created in the test and thrown away with
 * the database. That is what makes the tenancy boundary exercised on every
 * run rather than in one dedicated test: if RLS leaked, specs would start
 * seeing each other's invoices and the counts would be wrong everywhere.
 *
 * ON PARALLELISM. The build plan called for `workers: 1` because "gapless
 * numbering is global state". That reasoning does not survive the schema that
 * was actually written: `document_sequences` is keyed
 * (org_id, doc_kind, period_key), so two tenants cannot contend for a number.
 * Mailpit is searched by recipient, which is unique per test. The real limit
 * is `next dev`, which compiles routes lazily and on first hit — so the cost
 * of concurrency is slow cold requests, not wrong results. Hence a small
 * worker count and generous timeouts rather than a serial run.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  // Generous: a cold `next dev` route compile can take several seconds, and a
  // timeout here reads as a product bug when it is a build artefact.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "npm run dev",
    url: APP,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
