import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { WebSocketServer } from 'ws'
import { createAsrBridge } from './asr/bridge.js'
import { testRtasrLlmConnection } from './asr/rtasrLlmProxy.js'
import { testRtasrConnection } from './asr/xfyunProxy.js'
import { runFullAnalysis } from './ai/analyze.js'
import { isTranscriptPolishEnabled } from './ai/transcriptPolish.js'
import {
  addKnowledgeDoc,
  deleteKnowledgeDoc,
  getAgentConfig,
  listKnowledgeDocs,
  saveAgentConfig,
} from './agent/configStore.js'
import {
  ensureDefaultUsers,
  getSessionOwned,
  login as authLogin,
  logout as authLogout,
  requireAuth,
  resolveAuthToken,
} from './auth/index.js'
import { hashUsername } from './auth/crypto.js'
import * as store from './db/store.js'
import { decodeUploadFilename, safeDiskFilename } from './utils/filename.js'
import { buildDocxBuffer } from './export/toDocx.js'
import { buildMarkdownReport } from './export/toMarkdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const UPLOAD_DIR = path.join(ROOT, 'uploads')
const PORT = Number(process.env.PORT) || 3200
const ASR_PROVIDER = process.env.ASR_PROVIDER || 'rtasr_llm'

fs.mkdirSync(UPLOAD_DIR, { recursive: true })
store.getDb()
await ensureDefaultUsers()
const firstUser = store.findUserByUsernameHash(hashUsername('admin1'))
if (firstUser) store.assignOrphanSessionsToUser(firstUser.id)

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

function mapSessionRow(session) {
  if (!session) return session
  const style =
    typeof session.subtitle_style === 'string'
      ? JSON.parse(session.subtitle_style || '{}')
      : session.subtitle_style || {}
  return {
    ...session,
    ppt_filename: decodeUploadFilename(session.ppt_filename),
    subtitle_style: style,
  }
}

function ownedSession(req, res) {
  const id = Number(req.params.id)
  const result = getSessionOwned(id, req.auth.userId)
  if (result.error) {
    res.status(result.status).json({ message: result.error })
    return null
  }
  return result.session
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    cb(null, safeDiskFilename(file.originalname))
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.pptx') cb(null, true)
    else cb(new Error('仅支持 .pptx 格式'))
  },
})

const KNOWLEDGE_DIR = path.join(ROOT, 'data', 'knowledge', 'tmp')
fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true })
const knowledgeUpload = multer({
  storage: multer.diskStorage({
    destination: KNOWLEDGE_DIR,
    filename: (_req, file, cb) => {
      cb(null, safeDiskFilename(file.originalname))
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.txt', '.md', '.pptx'].includes(ext)) cb(null, true)
    else cb(new Error('知识库仅支持 .txt / .md / .pptx'))
  },
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aiteacher-agent' })
})

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) {
    return res.status(400).json({ message: '请输入账号和密码' })
  }
  const result = await authLogin(username, password)
  if (!result.ok) return res.status(401).json({ message: result.message })
  res.json(result.data)
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  authLogout(req.auth.token)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ data: { id: req.auth.userId, username: req.auth.username } })
})

app.get('/api/agent/config', requireAuth, (req, res) => {
  res.json({ data: getAgentConfig(req.auth.userId) })
})

app.put('/api/agent/config', requireAuth, (req, res) => {
  try {
    const saved = saveAgentConfig(req.auth.userId, req.body || {})
    res.json({ data: saved })
  } catch (err) {
    res.status(400).json({ message: err.message || '保存失败' })
  }
})

app.get('/api/agent/knowledge', requireAuth, (req, res) => {
  res.json({ data: listKnowledgeDocs(req.auth.userId) })
})

app.post('/api/agent/knowledge', requireAuth, knowledgeUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请上传文件' })
    const title = String(req.body.title || '').trim()
    const originalName = decodeUploadFilename(req.file.originalname)
    const doc = await addKnowledgeDoc(req.auth.userId, {
      title: title || originalName,
      originalName,
      diskPath: req.file.path,
    })
    res.json({ data: doc })
  } catch (err) {
    res.status(400).json({ message: err.message || '上传失败' })
  }
})

app.delete('/api/agent/knowledge/:id', requireAuth, (req, res) => {
  const ok = deleteKnowledgeDoc(req.auth.userId, String(req.params.id))
  if (!ok) return res.status(404).json({ message: '文档不存在' })
  res.json({ ok: true })
})

app.get('/api/health/asr', async (_req, res) => {
  const appId = process.env.XFYUN_APP_ID
  const apiKey = process.env.XFYUN_API_KEY
  const apiSecret = process.env.XFYUN_API_SECRET

  if (!appId || !apiKey) {
    return res.status(500).json({
      ok: false,
      message: '未配置 XFYUN_APP_ID 或 XFYUN_API_KEY',
    })
  }

  const provider = ASR_PROVIDER
  let result
  if (provider === 'rtasr_llm') {
    result = await testRtasrLlmConnection({ appId, apiKey, apiSecret })
  } else if (provider === 'rtasr') {
    result = await testRtasrConnection({ appId, apiKey })
  } else {
    result = await testRtasrLlmConnection({ appId, apiKey, apiSecret })
  }

  res.status(result.ok ? 200 : 500).json({
    ...result,
    provider,
    aiPolish: isTranscriptPolishEnabled(),
  })
})

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = store.listSessions(req.auth.userId).map(mapSessionRow)
  res.json({ data: sessions })
})

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  res.json({ data: mapSessionRow(session) })
})

app.post('/api/sessions', requireAuth, upload.single('ppt'), (req, res) => {
  try {
    const title = String(req.body.title || '').trim() || '未命名课程'
    let subtitleStyle = {}
    if (req.body.subtitleStyle) {
      try {
        subtitleStyle = JSON.parse(req.body.subtitleStyle)
      } catch {
        subtitleStyle = {}
      }
    }
    const rawName = req.body.pptOriginalName || req.file?.originalname || null
    const pptFilename = rawName ? decodeUploadFilename(String(rawName)) : null
    const session = store.createSession({
      title,
      pptFilename,
      pptPath: req.file ? `/uploads/${req.file.filename}` : null,
      subtitleStyle,
      userId: req.auth.userId,
    })
    res.json({
      data: mapSessionRow(session),
    })
  } catch (err) {
    res.status(400).json({ message: err.message || '创建失败' })
  }
})

app.patch('/api/sessions/:id/subtitle-style', requireAuth, (req, res) => {
  if (!ownedSession(req, res)) return
  store.updateSessionSubtitleStyle(Number(req.params.id), req.body.subtitleStyle || {})
  res.json({ ok: true })
})

app.post('/api/sessions/:id/slide', requireAuth, (req, res) => {
  if (!ownedSession(req, res)) return
  const id = Number(req.params.id)
  const slideIndex = Number(req.body.slideIndex)
  const eventAtMs = Number(req.body.eventAtMs ?? Date.now())
  if (!Number.isInteger(slideIndex) || slideIndex < 0) {
    return res.status(400).json({ message: 'slideIndex 不合法' })
  }
  store.addSlideEvent(id, slideIndex, eventAtMs)
  res.json({ ok: true })
})

app.post('/api/sessions/:id/transcript', requireAuth, (req, res) => {
  if (!ownedSession(req, res)) return
  const id = Number(req.params.id)
  const { text, slideIndex, startMs, endMs, isFinal } = req.body
  if (!text) return res.status(400).json({ message: 'text 不能为空' })
  const segId = store.addTranscriptSegment({
    sessionId: id,
    slideIndex: slideIndex ?? 0,
    text,
    startMs,
    endMs,
    isFinal: isFinal !== false,
  })
  res.json({ data: { id: segId } })
})

app.post('/api/sessions/:id/end', requireAuth, async (req, res) => {
  if (!ownedSession(req, res)) return
  const id = Number(req.params.id)
  const beforeEnd = store.getActiveRound(id)
  const roundNumber = beforeEnd?.round_number ?? null
  const { session, endedRound } = store.endSession(id)
  if (!session) return res.status(404).json({ message: '课程不存在' })

  let analysisResult = null
  let analysisError = null
  if (endedRound) {
    try {
      analysisResult = await runFullAnalysis(store, id, endedRound.round_number)
    } catch (err) {
      analysisError = err.message || 'AI 分析失败'
      console.warn(`[end] session ${id} round ${endedRound.round_number} analysis:`, analysisError)
    }
  }

  res.json({
    data: mapSessionRow(session),
    endedRound: roundNumber,
    analysis: analysisResult,
    analysisError,
  })
})

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  const id = Number(req.params.id)
  if (session.ppt_path) {
    const filePath = path.join(ROOT, session.ppt_path.replace(/^\//, ''))
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  store.deleteSession(id)
  res.json({ ok: true })
})

app.delete('/api/sessions/:id/rounds/:roundNumber', requireAuth, (req, res) => {
  try {
    if (!ownedSession(req, res)) return
    const sessionId = Number(req.params.id)
    const roundNumber = Number(req.params.roundNumber)
    if (!Number.isInteger(roundNumber) || roundNumber <= 0) {
      return res.status(400).json({ message: '课次编号不合法' })
    }
    const session = store.deleteRound(sessionId, roundNumber)
    if (!session) return res.status(404).json({ message: '课程不存在' })
    res.json({ data: mapSessionRow(session) })
  } catch (err) {
    res.status(400).json({ message: err.message || '删除失败' })
  }
})

app.post('/api/sessions/:id/analyze', requireAuth, async (req, res) => {
  if (!ownedSession(req, res)) return
  const id = Number(req.params.id)
  const roundNumber = req.query.round != null ? Number(req.query.round) : null
  try {
    const result = await runFullAnalysis(store, id, roundNumber)
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ message: err.message || 'AI 分析失败' })
  }
})

app.get('/api/sessions/:id/report', requireAuth, (req, res) => {
  if (!ownedSession(req, res)) return
  const roundNumber = req.query.round != null ? Number(req.query.round) : null
  const report = store.getReport(Number(req.params.id), roundNumber)
  if (!report) return res.status(404).json({ message: '课程不存在' })
  res.json({
    data: {
      ...report,
      session: mapSessionRow(report.session),
    },
  })
})

app.post('/api/sessions/:id/continue', requireAuth, (req, res) => {
  try {
    if (!ownedSession(req, res)) return
    const id = Number(req.params.id)
    const session = store.continueSession(id)
    res.json({ data: mapSessionRow(session) })
  } catch (err) {
    res.status(400).json({ message: err.message || '无法继续上课' })
  }
})

app.get('/api/sessions/:id/export', requireAuth, async (req, res) => {
  if (!ownedSession(req, res)) return
  const id = Number(req.params.id)
  const roundNumber = req.query.round != null ? Number(req.query.round) : null
  const report = store.getReport(id, roundNumber)
  if (!report) return res.status(404).json({ message: '课程不存在' })

  const format = String(req.query.format || 'md').toLowerCase()
  const roundSuffix = report.currentRound ? `-第${report.currentRound.round_number}节` : ''
  const safeTitle = report.session.title.replace(/[^\w\u4e00-\u9fff-]+/g, '_')

  try {
    if (format === 'docx') {
      const buffer = await buildDocxBuffer(report)
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}${roundSuffix}-课后报告.docx`)}`,
      )
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      return res.send(buffer)
    }

    const md = buildMarkdownReport(report)
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeTitle}${roundSuffix}-课后报告.md`)}`,
    )
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    return res.send(md)
  } catch (err) {
    res.status(500).json({ message: err.message || '导出失败' })
  }
})

app.use('/uploads', express.static(UPLOAD_DIR))

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

let listenRetried = false

function startListening() {
  server.listen(PORT, () => {
    console.log(`AiTeacherAgent server http://localhost:${PORT}`)
    console.log(`ASR provider: ${ASR_PROVIDER}`)
    console.log(`ASR AI polish: ${isTranscriptPolishEnabled() ? 'enabled' : 'disabled'}`)
    console.log(`WebSocket: ws://localhost:${PORT}/ws/asr?sessionId=<id>`)
  })
}

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE' && !listenRetried) {
    listenRetried = true
    console.warn(`[server] 端口 ${PORT} 被占用，正在尝试释放…`)
    try {
      const { freePort } = await import('../scripts/free-port.js')
      await freePort(String(PORT))
      setTimeout(startListening, 300)
    } catch {
      console.error(`[server] 端口 ${PORT} 仍被占用。请先 Ctrl+C 停掉旧进程，再执行 npm run dev`)
      process.exit(1)
    }
    return
  }
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] 端口 ${PORT} 仍被占用。请先 Ctrl+C 停掉旧进程，再执行 npm run dev`)
  } else {
    console.error('[server] 启动失败:', err.message)
  }
  process.exit(1)
})

startListening()

const slideState = new Map()

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  if (url.pathname !== '/ws/asr') {
    socket.destroy()
    return
  }

  const sessionId = Number(url.searchParams.get('sessionId'))
  const token = url.searchParams.get('token')
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
    socket.destroy()
    return
  }

  const auth = resolveAuthToken(token)
  if (!auth) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  const owned = getSessionOwned(sessionId, auth.userId)
  if (owned.error) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, { sessionId })
  })
})

wss.on('connection', (clientWs, { sessionId }) => {
  const appId = process.env.XFYUN_APP_ID
  const apiKey = process.env.XFYUN_API_KEY
  const apiSecret = process.env.XFYUN_API_SECRET

  if (!appId || !apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: '服务端未配置讯飞 API' }))
    clientWs.close()
    return
  }

  const sessionRow = store.getSession(sessionId)
  if (!sessionRow) {
    clientWs.send(JSON.stringify({ type: 'error', message: '课程不存在' }))
    clientWs.close()
    return
  }

  const activeRound = store.getActiveRoundForSession(sessionId)
  if (!activeRound) {
    clientWs.send(JSON.stringify({ type: 'error', message: '当前没有进行中的课次，请先继续上课' }))
    clientWs.close()
    return
  }

  let currentSlide = slideState.get(sessionId) ?? 0
  const roundStartMs = activeRound.started_at_ms || Date.now()
  const roundId = activeRound.id
  const recentPolished = []

  const bridge = createAsrBridge({
    provider: ASR_PROVIDER,
    appId,
    apiKey,
    apiSecret,
    clientWs,
    getSlideIndex: () => currentSlide,
    getContext: () => ({
      sessionTitle: sessionRow.title,
      slideIndex: currentSlide,
      recentTranscript: recentPolished.slice(-6).join(''),
    }),
    onFinalText: (text) => {
      const plain = text.replace(/^\[说话人\d+\]\s*/, '')
      recentPolished.push(plain)
      if (recentPolished.length > 12) recentPolished.splice(0, recentPolished.length - 12)

      const nowMs = Date.now() - roundStartMs
      store.addTranscriptSegment({
        sessionId,
        roundId,
        slideIndex: currentSlide,
        text,
        startMs: nowMs,
        endMs: nowMs,
        isFinal: true,
      })
    },
  })

  clientWs.on('message', (data) => {
    if (typeof data === 'string' || !(Buffer.isBuffer(data))) {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'slide') {
          const n = Number(msg.slideIndex)
          if (Number.isInteger(n) && n >= 0) {
            currentSlide = n
            slideState.set(sessionId, currentSlide)
          }
        }
      } catch {
        // ignore
      }
    }
    bridge.handleClientMessage(data)
  })

  clientWs.on('close', () => {
    bridge.close()
  })
})

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(ROOT, 'client/dist')
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get(/^(?!\/api|\/uploads|\/ws).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }
}

function shutdown() {
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 800)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
