/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const WINDOWS_SYSTEM_FILE_PATTERN =
  /(?:^|[\\/])(DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)$/i;

const config = {
  webpack: (webpackConfig, { dev }) => {
    if (dev) {
      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        // Ignore Windows root system files that can throw EINVAL during Watchpack's initial scan.
        ignored: WINDOWS_SYSTEM_FILE_PATTERN,
      };
    }

    return webpackConfig;
  },
};

export default config;
