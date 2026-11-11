// Metro konfiguracija (Expo). Produkcija: katalog komponenti se NE pakuje (Dio 1e) —
// resolver `src/katalog-body` mapira na prazni stub kad NODE_ENV=production.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// `wasm` je asset (expo-sqlite web koristi wa-sqlite).
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

if (process.env.NODE_ENV === "production") {
  const stub = path.resolve(__dirname, "src/katalog-body.stub.tsx");
  const originalResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.endsWith("katalog-body")) {
      return { type: "sourceFile", filePath: stub };
    }
    if (originalResolveRequest) return originalResolveRequest(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
