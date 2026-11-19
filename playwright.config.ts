import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3174);

export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: "retain-on-failure",
        // Settles transitions before axe measures colours, and exercises the reduced motion styles.
        contextOptions: { reducedMotion: "reduce" },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
        // Production build in demo mode: no API key, so the app replays recorded streams.
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        // The default limit of 20 requests per 10 minutes is for a public demo. One run of the suite sends more than that from one address.
        env: { ANTHROPIC_API_KEY: "", RATE_LIMIT_REQUESTS: "500" },
    },
});
