import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integracijski testovi dijele bazu; serijski izvršavaju da izolacija bude deterministična.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
