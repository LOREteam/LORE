const PROJECT_ROOT = process.env.PROJECT_ROOT || "/root/LORE";
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || "/root/.pm2/logs";

module.exports = {
  apps: [
    {
      name: "lore-site",
      cwd: PROJECT_ROOT,
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      out_file: `${PM2_LOG_DIR}/lore-site-out.log`,
      error_file: `${PM2_LOG_DIR}/lore-site-error.log`,
      merge_logs: true,
      time: true,
    },
    {
      name: "lore-bot",
      cwd: PROJECT_ROOT,
      script: "npm",
      args: "run bot",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      out_file: `${PM2_LOG_DIR}/lore-bot-out.log`,
      error_file: `${PM2_LOG_DIR}/lore-bot-error.log`,
      merge_logs: true,
      time: true,
    },
    {
      name: "lore-indexer",
      cwd: PROJECT_ROOT,
      script: "npm",
      args: "run indexer",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      out_file: `${PM2_LOG_DIR}/lore-indexer-out.log`,
      error_file: `${PM2_LOG_DIR}/lore-indexer-error.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
