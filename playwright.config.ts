import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

/** Isolated e2e DB — avoids sticky locks from reused servers / shared data dirs. */
const e2eDbPath = join(mkdtempSync(join(tmpdir(), "maa-e2e-")), "maa-e2e.sqlite");

export default defineConfig({
  testDir: "./e2e",
  // Terminal analysis wait is 45s; keep suite timeout above that (I6e timing fix).
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: CI ? "line" : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @maa/server start",
      url: "http://127.0.0.1:4320/health",
      reuseExistingServer: !CI,
      timeout: 60_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        MAA_DATABASE_PATH: e2eDbPath,
        MAA_DEEPSEEK_ENABLED: "false",
        MAA_DEFAULT_MODEL_PROFILE: "mock-only",
        MAA_FAKE_PHASE_DELAY_MS: "20",
        MAA_WORKER_POLL_MS: "200",
        MAA_API_KEY: "",
        MAA_REQUIRE_API_KEY: "false"
      }
    },
    {
      command: "pnpm --filter @maa/console dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !CI,
      timeout: 60_000
    }
  ]
});
