module.exports = function (api) {
  api.cache(true);
  return {
    // Resolve from this package even when Xcode invokes Metro from the workspace.
    presets: [[require.resolve("babel-preset-expo"), { unstable_transformImportMeta: true }]],
  };
};
