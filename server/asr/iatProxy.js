import crypto from 'node:crypto'
import { WebSocket } from 'ws'

const IAT_HOST = 'iat-api.xfyun.cn'
const IAT_PATH = '/v2/iat'

export function buildIatAuthUrl({ apiKey, apiSecret }) {
  const date = new Date().toUTCString()
  const signatureOrigin = `host: ${IAT_HOST}\ndate: ${date}\nGET ${IAT_PATH} HTTP/1.1`
  const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin).toString('base64')
  const params = new URLSearchParams({
    authorization,
    date,
    host: IAT_HOST,
  })
  return `wss://${IAT_HOST}${IAT_PATH}?${params.toString()}`
}

export function buildIatFirstFrame(appId) {
  return JSON.stringify({
    common: { app_id: appId },
    business: {
      language: 'zh_cn',
      domain: 'iat',
      accent: 'mandarin',
      vad_eos: 10000,
      dwa: 'wpgs',
    },
    data: {
      status: 0,
      format: 'audio/L16;rate=16000',
      encoding: 'raw',
      audio: '',
    },
  })
}

export function buildIatAudioFrame(audioBase64, status) {
  return JSON.stringify({
    data: {
      status,
      format: 'audio/L16;rate=16000',
      encoding: 'raw',
      audio: audioBase64,
    },
  })
}

export function parseIatMessage(data) {
  try {
    const msg = JSON.parse(data.toString())
    if (msg.code !== 0) {
      return {
        type: 'error',
        code: String(msg.code || ''),
        message: `[${msg.code}] ${msg.message || '语音听写错误'}`,
        hint:
          msg.code === 10105 || msg.code === 11200
            ? '请到控制台为该应用添加「语音听写（流式版）」服务。'
            : null,
        raw: msg,
      }
    }

    const text = (msg.data?.result?.ws || [])
      .flatMap((w) => w.cw || [])
      .map((c) => c.w || '')
      .join('')

    const isFinal = msg.data?.status === 2
    const isSentenceEnd = msg.data?.result?.pgs === 'apd' || msg.data?.result?.pgs === 'rpl'

    return {
      type: 'result',
      text,
      isFinal: isFinal || isSentenceEnd,
      raw: msg,
    }
  } catch {
    return null
  }
}

export function testIatConnection({ appId, apiKey, apiSecret }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(buildIatAuthUrl({ apiKey, apiSecret }))
    const timer = setTimeout(() => {
      ws.close()
      resolve({ ok: false, provider: 'iat', message: '连接讯飞超时' })
    }, 8000)

    ws.on('open', () => {
      ws.send(buildIatFirstFrame(appId))
    })

    ws.on('message', (data) => {
      clearTimeout(timer)
      const parsed = parseIatMessage(data)
      ws.close()
      if (parsed?.type === 'error') {
        resolve({
          ok: false,
          provider: 'iat',
          code: parsed.code,
          message: parsed.message,
          hint: parsed.hint,
        })
      } else {
        resolve({ ok: true, provider: 'iat', message: '语音听写（流式版）鉴权成功' })
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      const msg = String(err.message || '')
      resolve({
        ok: false,
        provider: 'iat',
        message: msg.includes('401')
          ? '[401] 鉴权失败，请确认已开通「语音听写（流式版）」且 APISecret 正确'
          : '无法连接讯飞语音听写服务器',
        hint: '控制台 → 我的应用 → 添加「语音听写（流式版）」→ 复制 APISecret 到 .env 的 XFYUN_API_SECRET',
      })
    })
  })
}
