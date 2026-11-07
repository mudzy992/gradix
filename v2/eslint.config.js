// Jedan lint za cijeli workspace. Pravila koja moraju padati u CI-ju, ne samo pisati u dokumentaciji.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/coverage/**", "**/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A3.3.7 / A3.3.10: nema console.log u aplikativnom kodu (logger ili ništa).
      "no-console": ["error", { allow: ["error", "warn"] }],
      // Ne koristi se `any` da bi se zaobišao strict; ako baš treba, `unknown` + provjera.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/test/**/*.ts", "**/scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  }
);
