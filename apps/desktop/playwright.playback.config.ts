import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
export default defineConfig({
  ...config,
  webServer: undefined,
  testMatch: "audio-controls.spec.ts",
  retries: 0,
  workers: 1,
  use: { ...config.use, baseURL: "http://localhost" },
});
