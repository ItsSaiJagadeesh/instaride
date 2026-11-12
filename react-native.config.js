/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The Mappls map library refuses to build without your two Mappls licence files. So it is linked into the
 * Android app ONLY when the build is set up for Mappls (MAPPLS_ENABLED=1). Every other build leaves it out,
 * which keeps local development and builds without the files working.
 */
const mapplsOn = process.env.MAPPLS_ENABLED === '1';

module.exports = {
  dependencies: mapplsOn
    ? {}
    : { 'mappls-map-react-native': { platforms: { android: null, ios: null } } },
};
