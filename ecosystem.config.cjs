module.exports = {
  apps: [
    {
      name: "lore-site",
      cwd: "/root/LORE",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      out_file: "/root/.pm2/logs/lore-site-out.log",
      error_file: "/root/.pm2/logs/lore-site-error.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "lore-bot-supervisor",
      cwd: "/root/LORE",
      script: "npm",
      args: "run bot:supervisor",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      out_file: "/root/.pm2/logs/lore-bot-out.log",
      error_file: "/root/.pm2/logs/lore-bot-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
