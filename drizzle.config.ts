import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev",
  },
  strict: true,
});
