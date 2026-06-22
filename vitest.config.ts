import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // `obsidian` ships type definitions only ("main": ""); provide a minimal
      // runtime stub so unit tests that transitively import it can load.
      obsidian: fileURLToPath(
        new URL("./__mocks__/obsidian.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
