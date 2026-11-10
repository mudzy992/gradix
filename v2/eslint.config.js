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
,
  {
    // U3 (U): ekrani koriste samo Gradix komponente. Zabrane; lista izuzetaka je
    // docs/UI-EXCEPTIONS.md i smije se samo smanjivati.
    files: ["apps/web/src/app/**/*.tsx"],
    ignores: [
      "apps/web/src/app/platform/**",
      // U3 izuzeci (docs/UI-EXCEPTIONS.md) — svaki red se briše kad se fajl migrira; lista se samo smanjuje.
      "apps/web/src/app/layout.tsx",
      "apps/web/src/app/page.tsx",
      "apps/web/src/app/ured/page.tsx",
      "apps/web/src/app/ured/korisnici/**",
      "apps/web/src/app/ured/masine/**",
      "apps/web/src/app/ured/projekti/**",
      "apps/web/src/app/ured/rokovi/**",
      "apps/web/src/app/**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "JSXOpeningElement[name.name='input']", message: "Koristi Input/Checkbox (U: components/ui)." },
        { selector: "JSXOpeningElement[name.name='select']", message: "Koristi Select." },
        { selector: "JSXOpeningElement[name.name='textarea']", message: "Koristi Textarea." },
        { selector: "JSXOpeningElement[name.name='table']", message: "Koristi DataTable." },
        { selector: "JSXOpeningElement[name.name='button']", message: "Koristi Button/IconButton." },
        { selector: "JSXOpeningElement[name.name='dialog']", message: "Koristi Dialog." },
        { selector: "JSXAttribute[name.name='style']", message: "Bez inline stila (U): tokeni i komponente." },
      ],
    },
  },
  {
    files: ["apps/mobile/src/app/**/*.tsx", "apps/mobile/src/teren/**/*.tsx"],
    // U3 mobile izuzeci: svi ekrani dok se ne migriraju (predložak U7b: Moj dan + prijava).
    ignores: ["apps/mobile/src/app/_layout.tsx", "apps/mobile/src/app/grupa.tsx", "apps/mobile/src/app/projekti.tsx", "apps/mobile/src/app/rokovi.tsx", "apps/mobile/src/teren/**"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "JSXOpeningElement[name.name='TextInput']", message: "Koristi TextField (U: src/ui)." },
        { selector: "JSXOpeningElement[name.name='Pressable']", message: "Koristi Button/Tile/BigActionButton (U: src/ui)." },
        { selector: "JSXOpeningElement[name.name='TouchableOpacity']", message: "Koristi Button (U: src/ui)." },
        { selector: "CallExpression[callee.object.name='StyleSheet'][callee.property.name='create']", message: "Bez StyleSheet.create u ekranu (U): stilovi žive u src/ui." },
      ],
    },
  },
  {
    // Upozorenje (ne greška): veliki klijentski fajlovi se dijele (U4: ≤~300 linija).
    files: ["apps/web/src/app/**/*client*.tsx", "apps/mobile/src/teren/**/*.tsx"],
    rules: { "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }] },
  }
);
