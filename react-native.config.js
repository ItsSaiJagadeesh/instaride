/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Two native libraries refuse to build without their licence or config files, so each is linked into the Android app
 * ONLY when the build is set up for it. Every other build leaves it out, which keeps local development and builds
 * without the files working.
 *   Mappls (map)                 MAPPLS_ENABLED=1    needs your two Mappls files
 *   Firebase (phone sign-in)     FIREBASE_ENABLED=1  needs google-services.json
 */
const off = { platforms: { android: null, ios: null } };
const mapplsOn = process.env.MAPPLS_ENABLED === '1';
const firebaseOn = process.env.FIREBASE_ENABLED === '1';

module.exports = {
  dependencies: {
    ...(mapplsOn ? {} : { 'mappls-map-react-native': off }),
    ...(firebaseOn ? {} : { '@react-native-firebase/app': off, '@react-native-firebase/auth': off }),
  },
};
