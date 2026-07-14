import { useEffect, useRef, useState } from 'react'
import type { LiveSubtitleLine } from '../hooks/useLiveSubtitle'
import { SPEAKER_COLORS, speakerLabel } from '../utils/liveSubtitle'
import type { SubtitleStyle } from '../types'

type Props = {
  lines: LiveSubtitleLine[]
  style: SubtitleStyle
  onStylePositionChange?: (x: number, y: number) => void
}

const MAX_LINES = 4

export function SubtitleOverlay({ lines, style, onStylePositionChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 })

  const displayLines = lines
    .filter((l) => l.text && l.status !== 'upcoming')
    .slice(-MAX_LINES)

  const positionStyle: React.CSSProperties =
    style.position === 'custom' && style.customX != null && style.customY != null
      ? { left: style.customX, top: style.customY, bottom: 'auto', transform: 'none' }
      : style.position === 'top'
        ? { top: 12, bottom: 'auto' }
        : { bottom: 16, top: 'auto' }

  useEffect(() => {
    if (style.position !== 'custom' || !ref.current) return
    const parent = ref.current.offsetParent as HTMLElement | null
    if (!parent) return
    if (style.customX == null || style.customY == null) {
      const rect = parent.getBoundingClientRect()
      onStylePositionChange?.(rect.width * 0.1, rect.height * 0.82)
    }
  }, [style.position, style.customX, style.customY, onStylePositionChange])

  const onPointerDown = (e: React.PointerEvent) => {
    if (style.position !== 'custom' || !ref.current) return
    setDragging(true)
    ref.current.setPointerCapture(e.pointerId)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      left: ref.current.offsetLeft,
      top: ref.current.offsetTop,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !ref.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    ref.current.style.left = `${dragStart.current.left + dx}px`
    ref.current.style.top = `${dragStart.current.top + dy}px`
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging || !ref.current) return
    setDragging(false)
    ref.current.releasePointerCapture(e.pointerId)
    onStylePositionChange?.(ref.current.offsetLeft, ref.current.offsetTop)
  }

  if (displayLines.length === 0) return null

  const showBg = style.backgroundOpacity > 0.05
  const lineBg = showBg
    ? { backgroundColor: `rgba(${hexToRgb(style.backgroundColor)}, ${style.backgroundOpacity})` }
    : undefined

  return (
    <div
      ref={ref}
      className={[
        'subtitle-overlay',
        'subtitle-lyrics',
        style.position === 'custom' ? 'draggable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...positionStyle,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        color: style.color,
        cursor: style.position === 'custom' ? 'move' : 'default',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="subtitle-lyrics-scroll">
        {displayLines.map((line, index) => {
          const speakerColor =
            line.speaker > 0
              ? SPEAKER_COLORS[line.speaker % SPEAKER_COLORS.length] || style.color
              : style.color
          const label = speakerLabel(line.speaker)
          const fromBottom = displayLines.length - 1 - index
          const depth =
            line.status === 'current' || fromBottom === 0
              ? 'is-current'
              : fromBottom === 1
                ? 'is-prev'
                : 'is-old'

          return (
            <div key={line.id} className="subtitle-line-wrap">
              <div
                className={[
                  'subtitle-line',
                  depth,
                  showBg ? 'has-bg' : '',
                  line.interim ? 'is-interim' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ color: speakerColor, ...lineBg }}
              >
                {label && <span className="subtitle-speaker">{label}</span>}
                {line.text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
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
