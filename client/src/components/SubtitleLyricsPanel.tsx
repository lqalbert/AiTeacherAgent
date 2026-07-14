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
  emptyHint = '开始转写后，字幕将在此滚动显示',
  title = '课堂字幕',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  const currentId = lines.find((l) => l.status === 'current')?.id

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentId, lines.length])

  const panelBg = style.panelBackgroundColor || '#ffffff'
  const panelIsLight = isLightColor(panelBg)
  const panelTextColor = contrastTextColor(style.color, panelIsLight)
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
              color: panelTextColor,
            }}
          >
            {lines.map((line) => {
              const speakerColor =
                line.speaker > 0
                  ? speakerPalette[line.speaker % speakerPalette.length] || panelTextColor
                  : panelTextColor
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
                    style={{ color: speakerColor, ...lineBg }}
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

/** 保证字幕与侧栏背景有足够对比度 */
function contrastTextColor(color: string, panelIsLight: boolean) {
  const textIsLight = isLightColor(color)
  if (panelIsLight && textIsLight) return '#1f1f1f'
  if (!panelIsLight && !textIsLight) return '#ffffff'
  return color
}

function isLightColor(hex: string) {
  const rgb = hexToRgb(hex)
    .split(',')
    .map((v) => Number(v.trim()))
  if (rgb.length < 3 || rgb.some((n) => Number.isNaN(n))) return false
  const [r, g, b] = rgb
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.72
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `${r}, ${g}, ${b}`
}
