# AiTeacherAgent 生产部署（对齐 QuizWiz 部署方式）

与 [QuizWiz teacher-admin/deploy/DEPLOY.md](../../QuizWiz/teacher-admin/deploy/DEPLOY.md) 同一套思路：

| 对比项 | QuizWiz | AiTeacherAgent |
|--------|---------|----------------|
| 代码路径 | `~/QuizWiz/teacher-admin` | `~/AiTeacherAgent` |
| 进程名 | `quizwiz-api` / PM2 | `aiteacher-agent` / PM2 |
| 内部端口 | 3000 | 3200 |
| 对外访问 | `https://www.quizwiz.cn` | 测试：`http://118.24.107.252:8080` |
| 数据库 | PostgreSQL | SQLite（`data/classroom.db`） |
| 前端 | Vite → Nginx root | Vite → Node 托管 `client/dist` |

## 首次部署（服务器上）

```bash
# 1. 代码放到 ~/AiTeacherAgent（git clone 或本机 rsync）
cd ~/AiTeacherAgent
cp deploy/env.server.template .env
nano .env

# 2. 构建
npm install --omit=dev
npm install --prefix client
npm run build

# 3. PM2（与 quizwiz-api 共存）
pm2 start deploy/ecosystem.config.cjs
pm2 save

# 4. Nginx 8080（不占用 QuizWiz 的 80/443）
sudo cp deploy/nginx-ip-8080.conf /etc/nginx/sites-available/aiteacher.conf
sudo ln -sf /etc/nginx/sites-available/aiteacher.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 本机一键推送（无 git 时）

```bash
cd /path/to/AiTeacherAgent
bash deploy/push-from-local.sh ubuntu@118.24.107.252
```

## 更新发版

```bash
cd ~/AiTeacherAgent
bash deploy/publish-on-server.sh
```

## 验证

```bash
bash deploy/verify.sh http://118.24.107.252:8080
```

## 注意

- **麦克风**：HTTP + IP 下浏览器可能禁止麦克风；HTTPS 域名下转写更稳定。
- **数据**：`data/` 与 `uploads/` 在服务器本地，更新代码时不要删这两目录。
- **ecosystem.config.cjs** 中 `cwd` 若用户名不是 `ubuntu`，请改为实际路径。
