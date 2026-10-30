import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Runs against a real PostgreSQL (shrouk_test). Start it with `npm run db:dev`; CI provides a service container. */
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["tests/integration/global-setup.ts"],
  },
});
