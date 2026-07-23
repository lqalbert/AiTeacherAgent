import crypto from 'node:crypto'
import { WebSocket } from 'ws'
import { extractSpeakerTexts, extractTextFromSt } from './speakerText.js'

const WS_HOST = 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1'

function urlEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

export function buildRtasrLlmSignature({
  appId,
  apiKey,
  apiSecret,
  uuid,
  lang = 'autodialect',
  audioEncode = 'pcm_s16le',
  samplerate = 16000,
  pd,
  engPunc = '0',
  engVadMdn = 2,
  roleType,
}) {
  const utc = formatUtc()
  const params = {
    accessKeyId: apiKey,
    appId,
    lang,
    utc,
    uuid,
    audio_encode: audioEncode,
    samplerate: String(samplerate),
    eng_punc: engPunc,
    eng_vad_mdn: String(engVadMdn),
  }
  if (pd) params.pd = pd
  if (roleType != null && String(roleType) !== '0') {
    params.role_type = String(roleType)
  }

  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${urlEncode(k)}=${urlEncode(params[k])}`)
    .join('&')

  const signature = crypto
    .createHmac('sha1', apiSecret)
    .update(sorted)
    .digest('base64')

  return { params, signature, sessionId: uuid }
}

function formatUtc() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const hh = pad(Math.floor(abs / 60))
  const mm = pad(abs % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}${mm}`
}

export function buildRtasrLlmWsUrl(opts) {
  const { params, signature } = buildRtasrLlmSignature(opts)
  const query = Object.keys(params)
    .sort()
    .map((k) => `${urlEncode(k)}=${urlEncode(params[k])}`)
    .concat(`signature=${urlEncode(signature)}`)
    .join('&')
  return `${WS_HOST}?${query}`
}

export function buildRtasrLlmEndMessage(sessionId) {
  return JSON.stringify({ end: true, sessionId })
}

function normalizeAsrData(msg) {
  let data = msg?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  return data && typeof data === 'object' ? data : null
}

function buildAsrResult(payload, st) {
  const text = extractTextFromSt(st)
  if (!text) return null

  const { segments, hasRoleSeparation } = extractSpeakerTexts(st)

  return {
    type: 'result',
    text,
    speakerSegments: segments.length ? segments : [{ speaker: 0, text }],
    hasRoleSeparation: Boolean(hasRoleSeparation),
    isFinal: st.type === '0' || st.type === 0,
    segId: payload.seg_id ?? 0,
    ls: Boolean(payload.ls ?? st?.ls),
    data: payload,
  }
}

export function parseRtasrLlmMessage(data) {
  try {
    const msg = JSON.parse(data.toString())

    // 新版：{"msg_type":"action","data":{"action":"started","sessionId":"..."}}
    // 旧版：{"action":"started"} 或 {"msg_type":"action","data":"started"}
    const nestedAction =
      msg?.data && typeof msg.data === 'object' ? msg.data.action : null
    const flatAction =
      msg.action ||
      (typeof msg.data === 'string' ? msg.data : null) ||
      nestedAction

    if (flatAction === 'started' || msg.action === 'started') {
      const sessionId =
        (msg?.data && typeof msg.data === 'object' && msg.data.sessionId) ||
        msg.sessionId ||
        null
      return { type: 'started', sessionId, raw: msg }
    }

    if (msg.action === 'error' || msg.msg_type === 'error' || nestedAction === 'error') {
      const errPayload = typeof msg.data === 'object' && msg.data ? msg.data : msg
      const code = String(errPayload.code || msg.code || '')
      const desc =
        errPayload.desc || errPayload.message || msg.desc || msg.message || '讯飞转写大模型错误'
      return {
        type: 'error',
        code,
        message: code ? `[${code}] ${desc}` : desc,
        raw: msg,
      }
    }

    if (msg.msg_type === 'result' && msg.res_type === 'asr') {
      const payload = normalizeAsrData(msg)
      const st = payload?.cn?.st
      if (!st?.rt) return null
      return { ...buildAsrResult(payload, st), raw: msg }
    }

    if (msg.action === 'result' && msg.data) {
      const payload =
        typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
      const st = payload?.cn?.st
      if (!st?.rt) return null
      return { ...buildAsrResult(payload, st), raw: msg }
    }

    if (msg.msg_type === 'result' && msg.res_type === 'frc') {
      return {
        type: 'error',
        message: msg.data?.desc || '转写异常',
        raw: msg,
      }
    }

    return { type: 'unknown', raw: msg }
  } catch {
    return null
  }
}

export function testRtasrLlmConnection({ appId, apiKey, apiSecret }) {
  return new Promise((resolve) => {
    if (!apiSecret) {
      resolve({
        ok: false,
        provider: 'rtasr_llm',
        message: '未配置 XFYUN_API_SECRET',
        hint: '大模型版需要 AppID + APIKey + APISecret，请将控制台 APISecret 填入 .env',
      })
      return
    }

    const uuid = crypto.randomUUID()
    const ws = new WebSocket(
      buildRtasrLlmWsUrl({
        appId,
        apiKey,
        apiSecret,
        uuid,
        pd: 'edu',
        engVadMdn: 2,
      }),
    )
    const timer = setTimeout(() => {
      ws.close()
      resolve({ ok: false, provider: 'rtasr_llm', message: '连接讯飞超时' })
    }, 8000)

    ws.on('message', (data) => {
      clearTimeout(timer)
      const parsed = parseRtasrLlmMessage(data)
      ws.close()
      if (parsed?.type === 'started') {
        resolve({ ok: true, provider: 'rtasr_llm', message: '实时语音转写大模型鉴权成功' })
      } else if (parsed?.type === 'result') {
        resolve({ ok: true, provider: 'rtasr_llm', message: '实时语音转写大模型连接成功' })
      } else if (parsed?.type === 'error') {
        resolve({
          ok: false,
          provider: 'rtasr_llm',
          code: parsed.code,
          message: parsed.message,
        })
      } else {
        resolve({ ok: true, provider: 'rtasr_llm', message: '实时语音转写大模型握手成功' })
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        provider: 'rtasr_llm',
        message: `无法连接: ${err.message}`,
      })
    })
  })
}
