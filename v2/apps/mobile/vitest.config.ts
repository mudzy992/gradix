import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `react-native` je u Flow-u i node parser ga ne čita; testovi koji provjeravaju stilove
    // (ne renderovanje) dobijaju mali stub. Vidi `src/test/react-native-stub.ts`.
    alias: {
      "react-native": path.resolve(__dirname, "src/test/react-native-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
