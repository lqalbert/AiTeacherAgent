function extractTextFromSt(st) {
  if (!st?.rt) return ''
  let text = ''
  for (const rt of st.rt) {
    for (const ws of rt.ws || []) {
      for (const cw of ws.cw || []) {
        const wp = cw.wp
        if (wp === 'p' || wp === 'g') continue
        text += cw.w || ''
      }
    }
  }
  return text
}

/**
 * 按 rl 字段拆分说话人（rl=0 延续上一说话人，rl=1/2/3… 切换）。
 */
export function extractSpeakerTexts(st, lastSpeaker = 1) {
  if (!st?.rt) return { segments: [], lastSpeaker, hasRoleSeparation: false }

  const segments = []
  let speaker = lastSpeaker
  let buf = ''
  let hasRl = false

  const flush = () => {
    const t = buf.trim()
    if (t) segments.push({ speaker, text: t })
    buf = ''
  }

  for (const rt of st.rt) {
    for (const ws of rt.ws || []) {
      for (const cw of ws.cw || []) {
        if (cw.wp === 'p' || cw.wp === 'g') continue
        const w = cw.w || ''
        if (!w) continue

        if (cw.rl !== undefined && cw.rl !== null) {
          hasRl = true
          const rl = Number(cw.rl)
          if (rl !== 0 && rl !== speaker) {
            flush()
            speaker = rl
          }
        }

        buf += w
      }
    }
  }
  flush()

  if (!hasRl) {
    const text = extractTextFromSt(st)
    return {
      segments: text ? [{ speaker: 0, text }] : [],
      lastSpeaker,
      hasRoleSeparation: false,
    }
  }

  return { segments, lastSpeaker: speaker, hasRoleSeparation: true }
}

export { extractTextFromSt }
