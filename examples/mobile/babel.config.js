module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@mgcrea/react-native-tailwind/babel'],
  };
};
