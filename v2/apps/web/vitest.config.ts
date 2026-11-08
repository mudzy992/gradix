import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Next drži `jsx: "preserve"` u tsconfig-u jer sam radi transform. Vitest 8 ide kroz Oxc
  // i čita `tsconfig`, pa mu treba sopstveni config sa `jsx: "react-jsx"` — inače padne na
  // prvom `<Komponenta>` u testu.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Dva okruženja: integracijski testovi (rute + baza) idu u `node`, a testovi ekrana
    // (tastatura, a11y) traže DOM. Fajl bira okruženje komentarom `@vitest-environment`.
    environment: "node",
    // Integracijski testovi dijele bazu; serijski izvršavaju da izolacija bude deterministična.
    fileParallelism: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
