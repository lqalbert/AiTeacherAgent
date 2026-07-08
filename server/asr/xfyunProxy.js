import crypto from 'node:crypto'
import { WebSocket } from 'ws'

export function buildXfyunSigna(appId, apiKey) {
  const ts = Math.floor(Date.now() / 1000).toString()
  const baseString = appId + ts
  const md5 = crypto.createHash('md5').update(baseString).digest('hex')
  const signa = crypto.createHmac('sha1', apiKey).update(md5).digest('base64')
  return { ts, signa }
}

const XFYUN_ERROR_HINTS = {
  '10105':
    'AppID 或 APIKey 未通过校验。请到控制台 → 我的应用 → 添加「实时语音转写」服务，并在该服务页面确认已领取试用时长。',
  '10110':
    '没有授权许可或时长已用完。请到控制台领取免费试用包或购买转写时长。',
  '10700':
    '15 秒内未发送音频数据，连接被断开。请确认麦克风权限已开启。',
}

export function getXfyunErrorHint(code) {
  return XFYUN_ERROR_HINTS[String(code)] || null
}

export function buildXfyunWsUrl({ appId, apiKey, lang = 'cn', pd }) {
  const { ts, signa } = buildXfyunSigna(appId, apiKey)
  const params = new URLSearchParams({ appid: appId, ts, signa, lang })
  if (pd) params.set('pd', pd)
  return `wss://rtasr.xfyun.cn/v1/ws?${params.toString()}`
}

export function parseXfyunMessage(data) {
  try {
    const msg = JSON.parse(data.toString())
    if (msg.action === 'started') {
      return { type: 'started', raw: msg }
    }
    if (msg.action === 'error') {
      const code = String(msg.code || '')
      const desc = msg.desc || msg.message || '讯飞转写错误'
      return {
        type: 'error',
        code,
        message: code ? `[${code}] ${desc}` : desc,
        hint: getXfyunErrorHint(code),
        raw: msg,
      }
    }
    if (msg.action === 'result') {
      const resultStr = msg.data
      if (!resultStr) return null
      const result = JSON.parse(resultStr)
      let text = ''
      let isFinal = false
      if (result.cn?.st?.rt) {
        for (const rt of result.cn.st.rt) {
          for (const ws of rt.ws || []) {
            for (const cw of ws.cw || []) {
              text += cw.w || ''
            }
          }
        }
        isFinal = result.cn.st.type === '0'
      }
      return { type: 'result', text, isFinal, raw: result }
    }
    return { type: 'unknown', raw: msg }
  } catch {
    return null
  }
}

export function testRtasrConnection({ appId, apiKey }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(buildXfyunWsUrl({ appId, apiKey }))
    const timer = setTimeout(() => {
      ws.close()
      resolve({ ok: false, provider: 'rtasr', message: '连接讯飞超时' })
    }, 8000)

    ws.on('message', (data) => {
      clearTimeout(timer)
      const parsed = parseXfyunMessage(data)
      ws.close()
      if (parsed?.type === 'started') {
        resolve({ ok: true, provider: 'rtasr', message: '实时语音转写鉴权成功' })
      } else if (parsed?.type === 'error') {
        resolve({
          ok: false,
          provider: 'rtasr',
          code: parsed.code,
          message: parsed.message,
          hint: parsed.hint,
        })
      } else {
        resolve({ ok: false, provider: 'rtasr', message: '未知响应' })
      }
    })

    ws.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, provider: 'rtasr', message: '无法连接讯飞服务器' })
    })
  })
}
