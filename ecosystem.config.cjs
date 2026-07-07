/**
 * pm2 process definition for running the built Sentinel agent continuously
 * on this PC. Uses CommonJS (.cjs) because package.json sets "type":
 * "module", and pm2's config loader expects a CommonJS export.
 */
module.exports = {
  apps: [
    {
      name: "sentinel",
      script: "dist/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: "logs/sentinel-out.log",
      error_file: "logs/sentinel-error.log",
      time: true,
    },
  ],
};
