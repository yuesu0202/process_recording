import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Pure-logic unit tests run in node; we never touch the DOM in lib/.
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
