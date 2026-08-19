import type { ExpoConfig } from 'expo/config';

/**
 * Trackt's mobile client (ADR-0008).
 *
 * There is no `extra.apiUrl` and there never will be: the app has no default
 * instance and no baked-in base URL. The origin comes from the server picker at
 * runtime and lives in SecureStore (ADR-0008 §2).
 *
 * `scheme` is load-bearing beyond deep links — better-auth's Expo plugin
 * replays the session against `trackt://`, which `apps/api` has to list in
 * `trustedOrigins` for sign-in to complete.
 *
 * No `newArchEnabled`: the mobile plan's scaffold table still lists it, but SDK
 * 57 dropped the flag along with the old architecture, and setting it is now a
 * type error. Reanimated 4's prerequisite is met by construction.
 */
const config: ExpoConfig = {
  name: 'Trackt',
  slug: 'trackt',
  version: '0.1.0',
  scheme: 'trackt',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'app.trackt.client',
    supportsTablet: true,
  },
  android: {
    package: 'app.trackt.client',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    'expo-font',
    'expo-image',
    // Phase 3. The date picker is a native module and needs the plugin even
    // though it takes no options; the image picker carries the avatar flow's
    // purpose string, which iOS rejects the build without.
    '@react-native-community/datetimepicker',
    [
      'expo-image-picker',
      {
        photosPermission: 'Trackt uses your photos so you can pick a profile picture.',
        // The avatar flow only ever opens the library. Left at their defaults
        // these two add a camera usage string and `RECORD_AUDIO` to the
        // manifest — permissions the app never asks for and cannot justify to a
        // reviewer.
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
