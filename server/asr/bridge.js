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
import { stripSubtitlePunctuation } from './subtitleText.js'

const IAT_MAX_MS = 50_000

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
  getSlideIndex,
  getContext,
}) {
  let upstream = null
  let iatTimer = null
  let iatOpened = false
  let llmSessionId = crypto.randomUUID()
  let llmReconnectTimer = null
  let llmLiveEmitter = null
  let polishChain = Promise.resolve()

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

  const emitFinalText = (rawText) => {
    const { speaker, text } = parseStoredText(rawText)
    if (!text) return

    polishChain = polishChain
      .then(async () => {
        let finalText = text
        let aiPolished = false

        if (isTranscriptPolishEnabled()) {
          try {
            const result = await polishTranscript(text, getContext?.() ?? {})
            finalText = result.text
            aiPolished = result.changed
          } catch (err) {
            console.warn('[asr/polish]', err.message)
          }
        }

        const display = stripSubtitlePunctuation(finalText)
        if (!display || display.length < 2) return

        sendClient({
          type: 'live',
          text: display,
          stable: true,
          speaker: speaker > 0 ? speaker : null,
          slideIndex: getSlideIndex(),
          aiPolished,
        })

        const storeText = speaker > 0 ? `[说话人${speaker}] ${finalText}` : finalText
        onFinalText(storeText)
      })
      .catch((err) => console.warn('[asr/polish/queue]', err.message))
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
      if (!parsed.isFinal) return
      if (parsed.text.trim()) {
        emitFinalText(parsed.text)
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
    const roleType = Number(process.env.XFYUN_ASR_ROLE_TYPE ?? 0)
    llmLiveEmitter = createRtasrLlmLiveEmitter({
      roleSeparation: roleType === 2,
      sendLive: () => {},
      onStoreText: emitFinalText,
    })

    upstream = new WebSocket(
      buildRtasrLlmWsUrl({
        appId,
        apiKey,
        apiSecret,
        uuid: llmSessionId,
        pd: process.env.XFYUN_ASR_PD || 'edu',
        engVadMdn: Number(process.env.XFYUN_ASR_VAD || 2),
        roleType,
      }),
    )

    upstream.on('open', () => {
      sendClient(connectedPayload('rtasr_llm'))
    })

    upstream.on('message', (data) => {
      const parsed = parseRtasrLlmMessage(data)
      if (!parsed) return

      if (parsed.type === 'error') {
        console.error('[asr/rtasr_llm]', parsed.code, parsed.message)
        sendClient({
          type: 'error',
          code: parsed.code,
          message: parsed.message,
          hint: parsed.hint,
        })
        return
      }

      if (parsed.type === 'started') {
        sendClient(connectedPayload('rtasr_llm'))
        return
      }

      if (parsed.type === 'result' && parsed.text) {
        llmLiveEmitter?.handleResult(parsed)
      }
    })

    upstream.on('close', () => {
      llmLiveEmitter?.flush()
      if (clientWs.readyState === 1 && !llmReconnectTimer) {
        llmReconnectTimer = setTimeout(() => {
          llmReconnectTimer = null
          if (clientWs.readyState === 1) connectRtasrLlm()
        }, 400)
        return
      }
      sendClient({ type: 'xfyun_closed' })
    })

    upstream.on('error', () => {
      sendClient({ type: 'error', message: '讯飞转写大模型连接异常' })
    })
  }

  const connectRtasr = () => {
    cleanupUpstream()
    upstream = new WebSocket(buildXfyunWsUrl({ appId, apiKey }))

    upstream.on('open', () => {
      sendClient(connectedPayload('rtasr'))
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
      if (provider === 'iat') {
        if (upstream?.readyState === 1 && iatOpened) {
          upstream.send(buildIatAudioFrame(buf.toString('base64'), 1))
        }
      } else if (upstream?.readyState === 1) {
        upstream.send(buf)
      }
      return
    }

    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'end') {
        if (provider === 'iat' && upstream?.readyState === 1) {
          upstream.send(buildIatAudioFrame('', 2))
        } else if (provider === 'rtasr_llm' && upstream?.readyState === 1) {
          upstream.send(buildRtasrLlmEndMessage(llmSessionId))
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
    if (provider === 'iat' && upstream?.readyState === 1) {
      try {
        upstream.send(buildIatAudioFrame('', 2))
      } catch {
        // ignore
      }
    } else if (provider === 'rtasr_llm' && upstream?.readyState === 1) {
      try {
        upstream.send(buildRtasrLlmEndMessage(llmSessionId))
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
    cleanupUpstream()
  }

  connect()

  return { handleClientMessage, close, reconnect: connect }
}
