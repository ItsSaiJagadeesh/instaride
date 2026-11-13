/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * By default this builds ONE app, InstaRide, with both roles (Rider and Driver).
 * It can also build a rider-only or driver-only app:
 *   APP_VARIANT=rider  EXPO_PUBLIC_APP_VARIANT=rider   -> InstaRider
 *   APP_VARIANT=driver EXPO_PUBLIC_APP_VARIANT=driver  -> InstaDriver
 * Static values live in app.json; this file adjusts name, package id, permissions and build safety checks.
 */
const VARIANTS = {
  rider: {
    name: 'InstaRider',
    slug: 'instarider',
    scheme: 'instarider',
    id: 'in.instaride.rider',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    camera: false,
  },
  driver: {
    name: 'InstaDriver',
    slug: 'instadriver',
    scheme: 'instadriver',
    id: 'in.instaride.driver',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'CAMERA'],
    camera: true,
  },
};

// Safety checks that only apply to builds made in the cloud (EAS), never to your own computer.
function checkCloudBuild() {
  if (!process.env.EAS_BUILD) return;
  if (process.env.EXPO_PUBLIC_DEMO === '1') return; // the demo build runs without any server
  const domain = process.env.EXPO_PUBLIC_DOMAIN || '';
  if (!domain || /REPLACE_WITH/i.test(domain)) {
    throw new Error('EXPO_PUBLIC_DOMAIN is not set. Put your server address (for example api.yourdomain.in) in eas.json before building.');
  }
  const isProduction = /production/i.test(process.env.EAS_BUILD_PROFILE || '');
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(domain);
  if (isProduction && local) {
    throw new Error('A production build cannot point at a local address (' + domain + '). Use your https server address.');
  }
  if (isProduction && process.env.ALLOW_CLEARTEXT === '1') {
    throw new Error('A production build must not allow plain http (ALLOW_CLEARTEXT). Remove it from this build profile.');
  }
}

// Plain http is blocked in installed Android apps. Test builds on your own Wi-Fi need it switched on.
function withCleartext(config) {
  if (process.env.ALLOW_CLEARTEXT !== '1') return config;
  return {
    ...config,
    plugins: [...(config.plugins || []), ['expo-build-properties', { android: { usesCleartextTraffic: true } }]],
  };
}

// Google Play needs the version code to go up with every upload. The build workflow passes the run number.
function withVersionCode(config) {
  const code = Number(process.env.ANDROID_VERSION_CODE);
  if (!Number.isInteger(code) || code < 1) return config;
  return { ...config, android: { ...config.android, versionCode: code } };
}

// The Google Maps key goes into the Android manifest, only for builds that use the real map (never the demo).
function withGoogleMaps(config) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (process.env.EXPO_PUBLIC_MAPS !== 'native' || process.env.EXPO_PUBLIC_DEMO === '1' || !key) return config;
  return { ...config, android: { ...config.android, config: { ...(config.android && config.android.config), googleMaps: { apiKey: key } } } };
}

// Mappls (the map for the real app): only for builds that were set up with the two Mappls licence files.
function withMappls(config) {
  if (process.env.MAPPLS_ENABLED !== '1') return config;
  return { ...config, plugins: [...(config.plugins || []), './plugins/with-mappls'] };
}

// Firebase (phone sign-in for real users): only for builds that were given google-services.json.
function withFirebase(config) {
  if (process.env.FIREBASE_ENABLED !== '1') return config;
  const file = process.env.FIREBASE_GOOGLE_SERVICES_FILE;
  if (!file || !require('fs').existsSync(file)) {
    throw new Error('FIREBASE_ENABLED=1 but FIREBASE_GOOGLE_SERVICES_FILE does not point to the google-services.json file.');
  }
  return {
    ...config,
    android: { ...config.android, googleServicesFile: file },
    plugins: [...(config.plugins || []), '@react-native-firebase/app'],
  };
}

module.exports = (args) => withFirebase(withMappls(withGoogleMaps(withVersionCode(build(args)))));

function build({ config }) {
  checkCloudBuild();
  const key = process.env.APP_VARIANT || process.env.EXPO_PUBLIC_APP_VARIANT;
  const v = VARIANTS[key];
  if (!v) return withCleartext(config); // the single InstaRide app with both roles

  const plugins = (config.plugins || []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return v.camera || name !== 'expo-image-picker';
  });

  return withCleartext({
    ...config,
    name: v.name,
    slug: v.slug,
    scheme: v.scheme,
    ios: { ...config.ios, bundleIdentifier: v.id },
    android: { ...config.android, package: v.id, permissions: v.permissions },
    plugins,
    extra: { ...(config.extra || {}), appVariant: key },
  });
}
