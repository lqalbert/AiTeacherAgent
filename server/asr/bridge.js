import crypto from 'node:crypto'
import { WebSocket } from 'ws'
import { isTranscriptPolishEnabled, polishTranscript } from '../ai/transcriptPolish.js'
import {
  buildIatAudioFrame,
  buildIatAuthUrl,
  buildIatFirstFrame,
  parseIatMessage,
} from './iatProxy.js'
import { createRtasrLlmLiveEmitter } from './rtasrLlmLive.js'
import {
  buildRtasrLlmEndMessage,
  buildRtasrLlmWsUrl,
  parseRtasrLlmMessage,
} from './rtasrLlmProxy.js'
import { buildXfyunWsUrl, parseXfyunMessage } from './xfyunProxy.js'
import { cleanSubtitleDisplay, stripSpeechFillers } from './subtitleText.js'

const IAT_MAX_MS = 50_000
/** 上游未就绪时缓存约 4 秒音频（40ms/帧） */
const MAX_UPSTREAM_PENDING = 100

function parseStoredText(raw) {
  const text = String(raw || '').trim()
  const m = text.match(/^\[说话人(\d+)\]\s*(.*)$/s)
  if (m) return { speaker: Number(m[1]), text: m[2].trim() }
  return { speaker: 0, text }
}

export function createAsrBridge({
  provider,
  appId,
  apiKey,
  apiSecret,
  clientWs,
  onFinalText,
  onPolishedText,
  getSlideIndex,
  getContext,
}) {
  let upstream = null
  let iatTimer = null
  let iatOpened = false
  let llmSessionId = crypto.randomUUID()
  /** 讯飞握手返回的 sessionId，结束帧必须用这个 */
  let llmRemoteSessionId = null
  let llmReconnectTimer = null
  let llmReconnectAttempts = 0
  let llmLiveEmitter = null
  let closed = false
  let lastErrorAt = 0
  /** @type {Buffer[]} */
  const pendingUpstream = []

  const sendClient = (payload) => {
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify(payload))
    }
  }

  const connectedPayload = (tag) => ({
    type: 'connected',
    provider: tag,
    aiPolish: isTranscriptPolishEnabled(),
  })

  const flushPendingUpstream = () => {
    if (!upstream || upstream.readyState !== 1) return
    while (pendingUpstream.length > 0) {
      const chunk = pendingUpstream.shift()
      try {
        upstream.send(chunk)
      } catch {
        break
      }
    }
  }

  const sendUpstreamAudio = (buf) => {
    if (provider === 'iat') {
      if (upstream?.readyState === 1 && iatOpened) {
        upstream.send(buildIatAudioFrame(buf.toString('base64'), 1))
      } else {
        pendingUpstream.push(buf)
        if (pendingUpstream.length > MAX_UPSTREAM_PENDING) pendingUpstream.shift()
      }
      return
    }

    if (upstream?.readyState === 1) {
      flushPendingUpstream()
      try {
        upstream.send(buf)
      } catch {
        pendingUpstream.push(buf)
      }
      return
    }

    pendingUpstream.push(buf)
    if (pendingUpstream.length > MAX_UPSTREAM_PENDING) pendingUpstream.shift()
  }

  /**
   * 最终句落库；可选推送客户端。
   * AI 校对结合课件与上文纠错并补标点，成功后回写转写记录；失败不撤销原文。
   * 直播字幕仍去标点展示；落库文本保留标点与分段。
   * revise=true：同一句递进结果，覆盖上一段而非新增。
   */
  const commitFinalText = (rawText, { pushClient = true, revise = false } = {}) => {
    const { speaker, text: rawParsed } = parseStoredText(rawText)
    const text = stripSpeechFillers(rawParsed)
    if (!text) return

    const display = cleanSubtitleDisplay(text)
    if (pushClient && display) {
      sendClient({
        type: 'live',
        text: display,
        stable: true,
        speaker: speaker > 0 ? speaker : null,
        slideIndex: getSlideIndex(),
        aiPolished: false,
      })
    }

    const storeText = speaker > 0 ? `[说话人${speaker}] ${text}` : text
    const segmentId = onFinalText?.(storeText, { revise }) ?? null

    if (!isTranscriptPolishEnabled()) return

    polishTranscript(text, getContext?.() ?? {})
      .then((result) => {
        if (!result?.text) return
        const polishedText = stripSpeechFillers(result.text)
        if (!polishedText || polishedText === text) return

        const polishedStore =
          speaker > 0 ? `[说话人${speaker}] ${polishedText}` : polishedText
        if (segmentId != null) {
          onPolishedText?.(segmentId, polishedStore)
        }

        const polishedDisplay = cleanSubtitleDisplay(polishedText)
        if (pushClient && polishedDisplay && polishedDisplay !== display) {
          sendClient({
            type: 'live',
            text: polishedDisplay,
            stable: true,
            speaker: speaker > 0 ? speaker : null,
            slideIndex: getSlideIndex(),
            aiPolished: true,
          })
        }
      })
      .catch((err) => console.warn('[asr/polish]', err.message))
  }

  const cleanupUpstream = () => {
    if (llmReconnectTimer) {
      clearTimeout(llmReconnectTimer)
      llmReconnectTimer = null
    }
    if (iatTimer) {
      clearTimeout(iatTimer)
      iatTimer = null
    }
    if (upstream) {
      try {
        upstream.close()
      } catch {
        // ignore
      }
      upstream = null
    }
    iatOpened = false
  }

  const handleParsed = (parsed, tag) => {
    if (!parsed) return

    if (parsed.type === 'error') {
      console.error(`[asr/${tag}]`, parsed.code, parsed.message)
      sendClient({
        type: 'error',
        code: parsed.code,
        message: parsed.message,
        hint: parsed.hint,
      })
      return
    }

    if (parsed.type === 'started') {
      sendClient(connectedPayload(tag))
      return
    }

    if (parsed.type === 'result' && parsed.text) {
      if (!parsed.isFinal) {
        const display = cleanSubtitleDisplay(parsed.text)
        if (display) {
          sendClient({
            type: 'live',
            text: display,
            stable: false,
            speaker: null,
            slideIndex: getSlideIndex(),
          })
        }
        return
      }
      if (parsed.text.trim()) {
        commitFinalText(parsed.text)
      }
    }
  }

  const connectRtasrLlm = () => {
    cleanupUpstream()
    if (!apiSecret) {
      sendClient({
        type: 'error',
        message: '未配置 XFYUN_API_SECRET',
        hint: '实时语音转写大模型需要 APISecret，请从控制台复制到 .env',
      })
      return
    }

    llmSessionId = crypto.randomUUID()
    llmRemoteSessionId = null
    const roleType = Number(process.env.XFYUN_ASR_ROLE_TYPE ?? 0)
    llmLiveEmitter = createRtasrLlmLiveEmitter({
      roleSeparation: roleType === 2,
      sendLive: ({ text, stable, speaker }) => {
        sendClient({
          type: 'live',
          text,
          stable: Boolean(stable),
          speaker: speaker ?? null,
          slideIndex: getSlideIndex(),
        })
      },
      // 上屏已由 sendLive 完成；此处仅落库，避免双重推送
      onStoreText: (text, opts = {}) =>
        commitFinalText(text, { pushClient: false, revise: Boolean(opts.revise) }),
    })

    const wsUrl = buildRtasrLlmWsUrl({
      appId,
      apiKey,
      apiSecret,
      uuid: llmSessionId,
      lang: process.env.XFYUN_ASR_LANG || 'autodialect',
      pd: process.env.XFYUN_ASR_PD || 'edu',
      engPunc: process.env.XFYUN_ASR_PUNC === '0' ? '0' : '1',
      engVadMdn: Number(process.env.XFYUN_ASR_VAD || 2),
      roleType,
    })

    upstream = new WebSocket(wsUrl)

    upstream.on('open', () => {
      llmReconnectAttempts = 0
      sendClient(connectedPayload('rtasr_llm'))
      flushPendingUpstream()
    })

    upstream.on('message', (data) => {
      const parsed = parseRtasrLlmMessage(data)
      if (!parsed) return

      if (parsed.type === 'error') {
        console.error('[asr/rtasr_llm]', parsed.code, parsed.message, parsed.raw)
        sendClient({
          type: 'error',
          code: parsed.code,
          message: parsed.message || '讯飞转写大模型错误',
          hint:
            parsed.hint ||
            '请检查控制台是否开通「实时语音转写大模型」、额度是否充足，以及 AppID/APIKey/APISecret 是否匹配',
        })
        return
      }

      if (parsed.type === 'started') {
        if (parsed.sessionId) llmRemoteSessionId = parsed.sessionId
        llmReconnectAttempts = 0
        sendClient(connectedPayload('rtasr_llm'))
        flushPendingUpstream()
        return
      }

      if (parsed.type === 'result' && parsed.text) {
        llmLiveEmitter?.handleResult(parsed)
      }
    })

    upstream.on('close', (code, reasonBuf) => {
      llmLiveEmitter?.flush()
      const reason = reasonBuf?.toString?.() || ''
      console.warn('[asr/rtasr_llm] close', code, reason)

      if (closed) return

      // 鉴权/参数类错误不要疯狂重连
      const fatal = code === 1008 || code === 4001 || code === 4002
      if (fatal) {
        sendClient({
          type: 'error',
          message: `讯飞连接已关闭(${code})${reason ? `: ${reason}` : ''}`,
          hint: '请核对 .env 中讯飞密钥，并确认已开通实时语音转写大模型',
        })
        return
      }

      if (clientWs.readyState === 1 && !llmReconnectTimer) {
        llmReconnectAttempts += 1
        if (llmReconnectAttempts > 20) {
          sendClient({
            type: 'error',
            message: '讯飞转写连接多次失败，已停止重连',
            hint: '请检查网络后重新点击「开始听课」',
          })
          return
        }
        sendClient({
          type: 'connected',
          provider: 'rtasr_llm',
          aiPolish: isTranscriptPolishEnabled(),
          reconnecting: true,
        })
        const delay = Math.min(5000, 400 * llmReconnectAttempts)
        llmReconnectTimer = setTimeout(() => {
          llmReconnectTimer = null
          if (!closed && clientWs.readyState === 1) connectRtasrLlm()
        }, delay)
        return
      }
      sendClient({ type: 'xfyun_closed' })
    })

    upstream.on('error', (err) => {
      const detail = err?.message || String(err)
      console.error('[asr/rtasr_llm] error', detail)
      const now = Date.now()
      // 避免 error + close 连发刷屏
      if (now - lastErrorAt < 1500) return
      lastErrorAt = now
      sendClient({
        type: 'error',
        message: `讯飞转写大模型连接异常：${detail}`,
        hint: '请确认本机可访问讯飞，且 .env 密钥正确、产品已开通并有余量',
      })
    })
  }

  const connectRtasr = () => {
    cleanupUpstream()
    upstream = new WebSocket(buildXfyunWsUrl({ appId, apiKey }))

    upstream.on('open', () => {
      sendClient(connectedPayload('rtasr'))
      flushPendingUpstream()
    })

    upstream.on('message', (data) => {
      handleParsed(parseXfyunMessage(data), 'rtasr')
    })

    upstream.on('close', () => {
      sendClient({ type: 'xfyun_closed' })
    })

    upstream.on('error', () => {
      sendClient({ type: 'error', message: '讯飞实时转写连接异常' })
    })
  }

  const scheduleIatReconnect = () => {
    if (iatTimer) clearTimeout(iatTimer)
    iatTimer = setTimeout(() => {
      if (clientWs.readyState === 1) connectIat()
    }, IAT_MAX_MS)
  }

  const connectIat = () => {
    cleanupUpstream()
    if (!apiSecret) {
      sendClient({
        type: 'error',
        message: '未配置 XFYUN_API_SECRET，无法使用语音听写',
        hint: '在 .env 中添加 XFYUN_API_SECRET，并设置 ASR_PROVIDER=iat',
      })
      return
    }

    upstream = new WebSocket(buildIatAuthUrl({ apiKey, apiSecret }))

    upstream.on('open', () => {
      upstream.send(buildIatFirstFrame(appId))
      iatOpened = true
      sendClient(connectedPayload('iat'))
      flushPendingUpstream()
      scheduleIatReconnect()
    })

    upstream.on('message', (data) => {
      handleParsed(parseIatMessage(data), 'iat')
    })

    upstream.on('close', () => {
      sendClient({ type: 'xfyun_closed' })
    })

    upstream.on('error', () => {
      sendClient({
        type: 'error',
        message: '讯飞语音听写连接异常',
        hint: '请确认已开通「语音听写（流式版）」且 APISecret 正确',
      })
    })
  }

  const connect = () => {
    if (provider === 'rtasr_llm') connectRtasrLlm()
    else if (provider === 'iat') connectIat()
    else connectRtasr()
  }

  const handleClientMessage = (data) => {
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      sendUpstreamAudio(buf)
      return
    }

    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'end') {
        if (provider === 'iat' && upstream?.readyState === 1) {
          upstream.send(buildIatAudioFrame('', 2))
        } else if (provider === 'rtasr_llm' && upstream?.readyState === 1) {
          const sid = llmRemoteSessionId || llmSessionId
          upstream.send(buildRtasrLlmEndMessage(sid))
        } else if (upstream?.readyState === 1) {
          upstream.send(JSON.stringify({ end: true }))
        }
      }
      if (msg.type === 'reconnect') {
        connect()
      }
    } catch {
      // ignore
    }
  }

  const close = () => {
    closed = true
    llmLiveEmitter?.flush()
    if (provider === 'iat' && upstream?.readyState === 1) {
      try {
        upstream.send(buildIatAudioFrame('', 2))
      } catch {
        // ignore
      }
    } else if (provider === 'rtasr_llm' && upstream?.readyState === 1) {
      try {
        const sid = llmRemoteSessionId || llmSessionId
        upstream.send(buildRtasrLlmEndMessage(sid))
      } catch {
        // ignore
      }
    } else if (upstream?.readyState === 1) {
      try {
        upstream.send(JSON.stringify({ end: true }))
      } catch {
        // ignore
      }
    }
    pendingUpstream.length = 0
    cleanupUpstream()
  }

  connect()

  return { handleClientMessage, close, reconnect: connect }
}
