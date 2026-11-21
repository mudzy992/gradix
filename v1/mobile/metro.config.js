const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const previousResolveRequest = config.resolver.resolveRequest;

// Expo Go SDK 57 + Android 16: worklets 0.10.1 JS vs older native libworklets
// SIGSEGV in memcpy (libworklets.so). Skip the JS package so init never runs.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'android' &&
    (moduleName === 'react-native-worklets' || moduleName.startsWith('react-native-worklets/'))
  ) {
    return { type: 'empty' };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
