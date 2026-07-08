# 智能课堂助手（AiTeacherAgent）

教师上课时的 Web 助手：展示 PPT、实时语音转写字幕、课后 AI 分析重难点并生成习题，支持 Word / Markdown 导出。

## 功能

- **PPT 放映**：上传 `.pptx`，全屏放映，键盘翻页
- **实时字幕**：讯飞实时语音转写大模型 + **AI 校对**（DeepSeek/通义千问修正术语与同音错字）
- **课堂记录**：自动保存转写文字与翻页时间戳
- **AI 报告**：DeepSeek / 通义千问分析重难点、生成总结与课后习题
- **导出**：一键下载 Markdown 或 Word 文档

## 环境要求

- Node.js 20+
- 讯飞开放平台账号（实时语音转写）
- DeepSeek 或阿里云 DashScope API Key（AI 分析）

## 快速开始

```bash
cd AiTeacherAgent
npm run setup
cp .env.example .env
# 编辑 .env 填入 API Key
npm run dev
```

浏览器打开 http://localhost:5173

## 环境变量

| 变量 | 说明 |
|------|------|
| `XFYUN_APP_ID` | 讯飞 AppID |
| `XFYUN_API_KEY` | 讯飞 API Key |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DASHSCOPE_API_KEY` | 通义千问 API Key |
| `AI_PROVIDER` | `deepseek` 或 `dashscope` |
| `ASR_AI_POLISH` | 是否开启实时字幕 AI 校对，默认 `true` |
| `ASR_HOTWORDS` | 学科热词（逗号分隔），提升术语识别准确度 |
| `PORT` | 后端端口，默认 3200 |

## 使用流程

1. 首页「新建课程」→ 填写标题并上传 `.pptx`
2. 进入课堂 → 点击「开始转写」→ 对着麦克风讲课
3. 可随时调整字幕样式（设置面板或拖拽自定义位置）
4. 讲课结束 →「结束课程」→ 生成 AI 报告
5. 在报告页下载 Word 或 Markdown

## 生产部署

```bash
npm run build
NODE_ENV=production npm start
```

将 `client/dist` 静态资源由 Express 托管，建议使用 Nginx 反向代理并配置 HTTPS（麦克风权限需要安全上下文）。

## 技术栈

- 前端：React 19 + Vite + TypeScript + Ant Design + pptx-preview
- 后端：Express 5 + WebSocket + SQLite
- 语音：讯飞实时语音转写 WebSocket API
- AI：DeepSeek / DashScope
- 导出：docx

## 注意事项

- 仅支持 `.pptx` 格式（不支持旧版 `.ppt`）
- 复杂 PPT 动画/视频在浏览器中可能无法完美还原
- 讯飞按转写时长计费，请在控制台关注用量
- 教室网络不稳定时，转写 WebSocket 会自动重连

## 目录结构

```
AiTeacherAgent/
├── client/          # React 前端
├── server/          # Express API + WebSocket
├── uploads/         # 上传的 PPT
├── data/            # SQLite 数据库（运行时生成）
└── .env.example
```
