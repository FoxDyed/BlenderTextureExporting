const { defineConfig } = require("playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10000,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    }
  ]
});
