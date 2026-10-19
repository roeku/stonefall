// Stands in for globby 11 inside @oclif/core 2.x, which the devvit CLI pins.
// Its only call is globby.sync(patterns, { cwd }) in config/plugin.js, listing
// a plugin's command files with two hard-coded patterns. globby 11 pulls in
// fast-glob → micromatch → braces, and braces has an advisory with no patched
// release (GHSA-vfj7-8cjw-p6xm). tinyglobby matches the same files without it.
// Drop this, and its override in package.json, once the CLI moves past
// @oclif/core 4.3.0.
const { globSync } = require('tinyglobby');

module.exports.sync = (patterns, options = {}) =>
  globSync(patterns, { expandDirectories: false, ...options });
