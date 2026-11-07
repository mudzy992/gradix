// Jedan lint za cijeli workspace. Pravila koja moraju padati u CI-ju, ne samo pisati u dokumentaciji.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-web/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/generated/**",
      "**/.turbo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript sam provjerava nedefinisane identitete; `no-undef` daje lažne pozitive na `console`.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-undef": "off",
      "no-console": ["error", { allow: ["error", "warn"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/test/**/*.ts", "**/scripts/**/*.ts", "**/scripts/**/*.mjs", "**/*.mjs"],
    rules: {
      "no-console": "off",
      "no-undef": "off",
    },
  },
  {
    // Metro/PostCSS konfiguracije su CommonJS po konvenciji Expo-a i Next-a.
    files: ["**/metro.config.js", "**/*.config.mjs", "**/*.config.js"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
