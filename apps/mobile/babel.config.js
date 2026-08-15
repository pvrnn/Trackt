/**
 * Metro's Babel config. Deliberately minimal — `babel-preset-expo` already
 * wires JSX, the router's entry, and (from SDK 54) the Worklets plugin when
 * Reanimated is installed. Nothing about the monorepo belongs here: Metro
 * discovers the workspace itself on SDK 52+, and hand-written `watchFolders` /
 * `nodeModulesPaths` are the top cause of "works on my machine" resolution
 * bugs (mobile plan, phase 0).
 */
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
