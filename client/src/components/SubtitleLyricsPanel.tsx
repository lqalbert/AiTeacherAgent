import { useEffect, useRef } from 'react'
import type { LiveSubtitleLine } from '../hooks/useLiveSubtitle'
import { SPEAKER_COLORS, speakerLabel } from '../utils/liveSubtitle'
import type { SubtitleStyle } from '../types'

type Props = {
  lines: LiveSubtitleLine[]
  style: SubtitleStyle
  emptyHint?: string
  title?: string
}

const LIGHT_SPEAKER_COLORS = [
  '',
  '#ad6800',
  '#389e0d',
  '#0958d9',
  '#d4380d',
  '#531dab',
  '#c41d7f',
]

export function SubtitleLyricsPanel({
  lines,
  style,
  emptyHint = '说完一整句后，字幕将换行显示在这里',
  title = '课堂字幕',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  const currentId = lines.find((l) => l.status === 'current')?.id

  // 仅当切换到新句时滚动；同一句递进改字不触发 scroll，避免闪烁
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [currentId])

  const panelBg = style.panelBackgroundColor || '#ffffff'
  const panelIsLight = isLightColor(panelBg)
  // 始终使用用户设置的文字颜色，不再因对比度强制改色
  const textColor = normalizeHex(style.color) || '#1f1f1f'
  const speakerPalette = panelIsLight ? LIGHT_SPEAKER_COLORS : SPEAKER_COLORS
  const showBg = style.backgroundOpacity > 0.05
  const lineBg = showBg
    ? {
        backgroundColor: `rgba(${hexToRgb(style.backgroundColor)}, ${Math.min(style.backgroundOpacity, 0.75)})`,
      }
    : undefined

  const muted = panelIsLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.55)'
  const empty = panelIsLight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.35)'
  const border = panelIsLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)'
  // 对比度不足时加描边，保证可读且不改用户所选颜色
  const needOutline = panelIsLight === isLightColor(textColor)
  const textShadow = needOutline
    ? panelIsLight
      ? '0 0 2px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.35)'
      : '0 0 2px rgba(255,255,255,0.7), 0 1px 2px rgba(0,0,0,0.45)'
    : undefined

  return (
    <aside
      className={['subtitle-lyrics-panel', panelIsLight ? 'is-light' : 'is-dark'].join(' ')}
      style={{ backgroundColor: panelBg, borderLeftColor: border }}
    >
      <div className="subtitle-lyrics-panel-header" style={{ color: muted, borderBottomColor: border }}>
        {title}
      </div>
      <div className="subtitle-lyrics-panel-scroll" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="subtitle-lyrics-empty" style={{ color: empty }}>
            {emptyHint}
          </div>
        ) : (
          <div
            className="subtitle-lyrics-list"
            style={{
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              color: textColor,
            }}
          >
            {lines.map((line) => {
              const speakerColor =
                line.speaker > 0
                  ? speakerPalette[line.speaker % speakerPalette.length] || textColor
                  : textColor
              const label = speakerLabel(line.speaker)
              const isCurrent = line.status === 'current'
              const isUpcoming = line.status === 'upcoming'

              return (
                <div
                  key={line.id}
                  ref={isCurrent ? currentRef : undefined}
                  className={[
                    'subtitle-lyrics-item',
                    isCurrent ? 'is-current' : '',
                    isUpcoming ? 'is-upcoming' : '',
                    line.status === 'past' ? 'is-past' : '',
                    line.interim ? 'is-interim' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div
                    className={['subtitle-lyrics-text', showBg ? 'has-bg' : ''].filter(Boolean).join(' ')}
                    style={{ color: speakerColor, textShadow, ...lineBg }}
                  >
                    {label && <span className="subtitle-speaker">{label}</span>}
                    {line.text}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

/** 规范化为 #RRGGBB */
function normalizeHex(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (raw.startsWith('#')) {
    const h = raw.slice(1)
    if (h.length === 3) return `#${h.split('').map((c) => c + c).join('')}`
    if (h.length >= 6) return `#${h.slice(0, 6)}`
    return raw
  }
  const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb) {
    const to = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`
  }
  return raw
}

function isLightColor(hex: string) {
  const normalized = normalizeHex(hex)
  const rgb = hexToRgb(normalized)
    .split(',')
    .map((v) => Number(v.trim()))
  if (rgb.length < 3 || rgb.some((n) => Number.isNaN(n))) return false
  const [r, g, b] = rgb
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.72
}

function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex).replace('#', '') || '000000'
  const full =
    normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized.slice(0, 6)
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return '0, 0, 0'
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `${r}, ${g}, ${b}`
}
