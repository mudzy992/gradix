/**
 * Build workera: `tsc` (provjera tipova) + `esbuild` (jedan ESM fajl).
 *
 * Zašto bundle, a ne goli `tsc`: `tsc` sa `moduleResolution: "Bundler"` emitira relativne uvoze
 * BEZ `.js` ekstenzija (`./config`). Node ESM ih u produkciji ne razrješava:
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/apps/worker/dist/config'
 * To se NE vidi u testovima (`tsx`/`vitest` razrješavaju kao bundler) ni u `tsc --noEmit` —
 * vidi se tek kad se `dist/main.js` pokrene pravim Node-om. Zato ovdje bundlujemo: sve naše
 * module u jedan fajl (nema relativnih uvoza koji bi se mogli pokvariti), a npm paketi ostaju
 * vanjski (`--packages=external`) i dolaze iz `node_modules` u slici.
 *
 * `@gradix/domain` i `@gradix/db` izvoze `src/*.ts`; esbuild ih čita i ugrađuje — zato
 * produkcijska slika više ne mora nositi njihov izvor.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * `@gradix/*` su workspace paketi, ali stoje u `dependencies` — a `external` lista se pravi iz
 * nje. Zato ih vraćamo u bundle izričito: razrješavamo ulaz iz `exports` mape paketa i puštamo
 * esbuild da ugrađuje i njih, i njihove relativne uvoze.
 */
const WORKSPACE = {
  "@gradix/domain": new URL("../../packages/domain/", import.meta.url),
  "@gradix/db": new URL("../../packages/db/", import.meta.url),
  "@gradix/contracts": new URL("../../packages/contracts/", import.meta.url),
};

const bundleWorkspace = {
  name: "gradix-workspace",
  setup(build_) {
    build_.onResolve({ filter: /^@gradix\// }, (args) => {
      // `@gradix/domain/worker` → paket `@gradix/domain`, podputanja `./worker`
      const [, paket, podputanja] = args.path.match(/^(@gradix\/[^/]+)(\/.*)?$/);
      const root = WORKSPACE[paket];
      if (!root) return null;
      const pkgJson = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
      const kljuc = podputanja ? "." + podputanja : ".";
      const cilj = pkgJson.exports?.[kljuc];
      if (!cilj) {
        throw new Error(`${args.path}: paket ${paket} nema izvoz "${kljuc}" u exports mapi`);
      }
      return { path: new URL(cilj.replace(/^\.\//, ""), root).pathname };
    });
  },
};

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // npm zavisnosti (pg, pg-boss, S3) ostaju vanjske: native-ish kod i vlastiti pool-ovi ne
  // smiju biti prepakovani. Bundle-uju se SAMO naši moduli (`@gradix/*` + relativni).
  //
  // `packages: "external"` ovdje NE valja: ono izbacuje i `@gradix/domain`, a taj paket izvozi
  // `.ts` izvor sa relativnim uvozima bez ekstenzija — Node bi ga u produkciji pokušao učitati
  // kao `.ts` i pao na `Cannot find module '.../src/money'`.
  external: [
    ...Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@gradix/")),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ],
  plugins: [bundleWorkspace],
  sourcemap: true,
  logLevel: "warning",
  // `import.meta.url` u ESM izlazu ostaje ispravan; bez ovoga esbuild bi ubacio `require`.
  banner: {
    js: [
      "// Worker bundle — generisano (`apps/worker/build.mjs`). Ne uređivati.",
      `// ${pkg.name}@${pkg.version}`,
    ].join("\n"),
  },
});

// ---------------------------------------------------------------------------
// Provjera poslije builda: nijedan uvoz ne smije biti relativan bez ekstenzije.
// Tačno to je pravilo koje je oborilo produkciju (`./config`), a ne vidi se ni u `tsc --noEmit`
// ni u testovima — zato se provjerava nad stvarnim izlazom, i build PADA ako se vrati.
// ---------------------------------------------------------------------------
const izlaz = readFileSync(new URL("./dist/main.js", import.meta.url), "utf8");
const sumnjivi = [...izlaz.matchAll(/from\s+"(\.{1,2}\/[^"]*)"/g)].map((m) => m[1]);
if (sumnjivi.length > 0) {
  throw new Error(
    `Bundle sadrži relativne uvoze koje Node ESM neće razriješiti: ${sumnjivi.join(", ")}. ` +
      "Provjeri plugin `bundleWorkspace` u build.mjs.",
  );
}
const gradix = [...izlaz.matchAll(/from\s+"(@gradix\/[^"]*)"/g)].map((m) => m[1]);
if (gradix.length > 0) {
  throw new Error(
    `Bundle uvozi workspace pakete (${gradix.join(", ")}) — u produkcijskoj slici njihov izvor ` +
      "više ne postoji. Ti paketi moraju biti ugrađeni u bundle.",
  );
}
