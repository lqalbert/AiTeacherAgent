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

- **麦克风（重要）**：`http://IP:8080` 下浏览器会禁用 `getUserMedia`，实时转写不可用。必须使用 **HTTPS** 或 **localhost**。
  - **测试**：自签证书 + 8443 端口，见下方「HTTPS 快速启用」
  - **正式**：绑定域名 + Let's Encrypt（与 QuizWiz 同服务器可另开子域名）
- **数据**：`data/` 与 `uploads/` 在服务器本地，更新代码时不要删这两目录。
- **ecosystem.config.cjs** 中 `cwd` 若用户名不是 `ubuntu`，请改为实际路径。

## HTTPS 快速启用（解决麦克风不可用）

浏览器安全策略：仅 `https://` 和 `http://localhost` 允许麦克风。IP + HTTP 会报 `navigator.mediaDevices` 未定义。

在服务器执行：

```bash
cd ~/AiTeacherAgent
sudo bash deploy/setup-https-selfsigned.sh
sudo cp deploy/nginx-https-8443.conf /etc/nginx/sites-available/aiteacher-https.conf
sudo ln -sf /etc/nginx/sites-available/aiteacher-https.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

腾讯云安全组放行 **TCP 8443**，浏览器访问：

**https://118.24.107.252:8443**

首次会提示证书不受信任，点「高级 → 继续访问」即可，麦克风可正常使用。

正式环境建议为项目单独申请子域名（如 `classroom.quizwiz.cn`），用 certbot 申请免费证书并配置 443。完整步骤见下方「方案 B：子域名 + Let's Encrypt」。

## 方案 B：子域名 + Let's Encrypt（推荐，麦克风可用）

与 QuizWiz（`www.quizwiz.cn`）同服务器、同 IP，为 AiTeacherAgent 单独开子域名，例如 **`classroom.quizwiz.cn`**。

### 1. 域名解析（在 quizwiz.cn 的 DNS 控制台）

| 记录类型 | 主机记录 | 记录值 |
|----------|----------|--------|
| A | `classroom` | `118.24.107.252` |

保存后等待几分钟，在服务器验证：

```bash
dig +short classroom.quizwiz.cn
# 应返回 118.24.107.252
```

> 子域名可自定（如 `aiteacher`），下文以 `classroom.quizwiz.cn` 为例；改 DNS 后所有命令里的域名一并替换。

### 2. 确认 Node 服务在跑

```bash
curl -s http://127.0.0.1:3200/api/health
sudo systemctl status aiteacher-agent
```

### 3. Nginx 先上 HTTP（certbot 签发前不能引用不存在的证书）

```bash
cd ~/AiTeacherAgent
git pull
sudo cp deploy/nginx-classroom.quizwiz.cn.http-only.conf /etc/nginx/sites-available/aiteacher-classroom.conf
sudo ln -sf /etc/nginx/sites-available/aiteacher-classroom.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

浏览器可先访问 `http://classroom.quizwiz.cn` 确认能打开（此时麦克风仍不可用，正常）。

### 4. 申请免费 HTTPS 证书

```bash
sudo certbot --nginx -d classroom.quizwiz.cn
```

按提示填邮箱、同意条款。成功后 certbot 会自动配置 443。

若未安装 certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 5. 验证 HTTPS

```bash
curl -s https://classroom.quizwiz.cn/api/health
bash deploy/verify.sh https://classroom.quizwiz.cn
```

浏览器打开 **https://classroom.quizwiz.cn**，进入课堂点「开始转写」，麦克风应可用。

### 6. 证书自动续期

```bash
sudo certbot renew --dry-run
```

Let's Encrypt 证书约 90 天，certbot 会通过 cron/systemd 自动续期。

### 7. 与 QuizWiz 的关系

| 站点 | 域名 | 后端端口 |
|------|------|----------|
| QuizWiz 教师端 | `www.quizwiz.cn` | 3000 |
| 智能课堂助教 | `classroom.quizwiz.cn` | 3200 |

两个站点互不影响；`8080` 的 IP 测试入口可保留或停用。

### 8. 腾讯云安全组

确保放行 **TCP 80**、**TCP 443**（QuizWiz 若已上线通常已放行）。
