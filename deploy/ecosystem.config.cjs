/**
 * PM2 配置（与 QuizWiz deploy/ecosystem.config.cjs 同用法）
 * 在服务器 cd ~/AiTeacherAgent 后执行：
 *   pm2 delete aiteacher-agent 2>/dev/null; pm2 start deploy/ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'aiteacher-agent',
      cwd: '/home/ubuntu/AiTeacherAgent',
      script: 'server/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3200',
      },
    },
  ],
}
