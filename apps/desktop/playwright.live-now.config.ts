import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

process.env.MULTISTREAM_E2E_BUILD = "1";

export default defineConfig({
  ...config,
  testMatch: "live-now.spec.ts",
  webServer: undefined,
  retries: 0,
  workers: 1,
  use: { ...config.use, baseURL: "http://localhost" },
});
