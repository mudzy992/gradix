import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Render testovi ekrana idu kroz react-native-web u jsdom-u: pravi `react-native` je Flow i
 * node ga ne čita, a ekrani su isti oni koji se dokazuju kroz `expo export -p web`.
 * Logički testovi (logicki testovi) ostaju na node stub konfiguraciji (vitest.config.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      "react-native": path.resolve(__dirname, "node_modules/react-native-web/dist/index.js"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.screen.test.tsx"],
  },
});
