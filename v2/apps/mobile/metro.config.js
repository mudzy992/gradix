// Metro za monorepo. Jedina prilagodba: `wasm` je asset (expo-sqlite web koristi wa-sqlite).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
