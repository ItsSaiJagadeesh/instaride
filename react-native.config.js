/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Native libraries that refuse to build without their licence or config files are linked into the Android app
 * ONLY when the build is set up for it. Every other build leaves it out, which keeps local development and builds
 * without the files working.
 *   Google Maps (via react-native-maps)  no setup needed
 *   Firebase (phone sign-in)             FIREBASE_ENABLED=1  needs google-services.json
 */
const off = { platforms: { android: null, ios: null } };
const firebaseOn = process.env.FIREBASE_ENABLED === '1';

module.exports = {
  dependencies: {
    'mappls-map-react-native': off, // Mappls is disabled; using Google Maps instead
    ...(firebaseOn ? {} : { '@react-native-firebase/app': off, '@react-native-firebase/auth': off }),
  },
};
