import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  SlideView,
  usePresentation,
  useFonts,
  useSlideAnimations,
  useSlideTransition,
} from '@pagus-kit/react'
import { computeSlideLayoutForSplitView } from '../utils/pptViewport'

export type PptViewerHandle = {
  next: () => void
  prev: () => void
  goTo: (index: number) => void
  getCurrentIndex: () => number
  getSlideCount: () => number
  enterFullscreen: () => void
}

type Props = {
  src: string | ArrayBuffer | null
  onSlideChange?: (index: number, total: number) => void
  /** 幻灯片渲染尺寸变化（用于外层布局自适应） */
  onLayoutChange?: (layout: { width: number; height: number }) => void
  /** 用户通过点击/滑动翻页时回调（如暂停回放） */
  onUserNavigate?: () => void
  /** 渲染在 PPT 容器内，全屏时一并显示（如字幕浮层） */
  overlay?: ReactNode
}

const SWIPE_MIN_PX = 48
const TAP_MAX_PX = 12
const GESTURE_MAX_MS = 900

/** 内部 0 基索引 → 用户看到的页码（1 起） */
export function toDisplayPage(index: number): number {
  return Math.max(0, index) + 1
}

function normalizeIndex(index: number): number {
  return Math.max(0, index)
}

export const PptViewer = forwardRef<PptViewerHandle, Props>(function PptViewer(
  { src, onSlideChange, onLayoutChange, onUserNavigate, overlay },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const slideContainerRef = useRef<HTMLDivElement>(null)

  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [slideIndex, setSlideIndex] = useState(0)
  const [prevSlideIndex, setPrevSlideIndex] = useState(-1)
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const slideIndexRef = useRef(0)
  const lastNotifiedRef = useRef({ index: -1, total: 0 })
  const transitioningRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const onUserNavigateRef = useRef(onUserNavigate)
  onUserNavigateRef.current = onUserNavigate

  const { status, presentation, error: parseError } = usePresentation(fileBuffer)
  const { status: fontStatus, fontSubstitutes } = useFonts(presentation?.fonts, {
    useGoogleFonts: true,
    useEmbeddedFonts: true,
  })

  const slideCount = presentation?.slides.length ?? 0
  const currentSlide = presentation?.slides[slideIndex]
  const prevSlide =
    prevSlideIndex >= 0 ? presentation?.slides[prevSlideIndex] : undefined

  const { isComplete, totalSteps, advance, currentHiddenIds } = useSlideAnimations(
    slideContainerRef,
    currentSlide?.animations,
  )
  const { isTransitioning, outgoingStyle, incomingStyle, startTransition } = useSlideTransition()

  const slideLayout = useMemo(() => {
    if (!presentation?.slideSize || !stageSize) return null
    return computeSlideLayoutForSplitView(
      stageSize.width,
      stageSize.height,
      presentation.slideSize.width,
      presentation.slideSize.height,
      isFullscreen ? 0 : undefined,
    )
  }, [presentation?.slideSize, stageSize, isFullscreen])

  useEffect(() => {
    if (!slideLayout || isFullscreen) return
    onLayoutChange?.(slideLayout.viewport)
  }, [slideLayout, onLayoutChange, isFullscreen])

  const notifySlide = useCallback(
    (index: number, total: number) => {
      const safeIndex = normalizeIndex(index)
      const safeTotal = Math.max(0, total)
      if (
        lastNotifiedRef.current.index === safeIndex &&
        lastNotifiedRef.current.total === safeTotal
      ) {
        return
      }
      lastNotifiedRef.current = { index: safeIndex, total: safeTotal }
      setSlideIndex(safeIndex)
      slideIndexRef.current = safeIndex
      onSlideChange?.(safeIndex, safeTotal)
    },
    [onSlideChange],
  )

  useEffect(() => {
    if (!src) {
      setFileBuffer(null)
      setLoadError(null)
      return
    }

    let cancelled = false
    setFetching(true)
    setLoadError(null)
    setSlideIndex(0)
    slideIndexRef.current = 0
    lastNotifiedRef.current = { index: -1, total: 0 }
    setStageSize(null)

    const load = async () => {
      try {
        let buffer: ArrayBuffer
        if (typeof src === 'string') {
          const res = await fetch(src)
          if (!res.ok) throw new Error('PPT 加载失败')
          buffer = await res.arrayBuffer()
        } else {
          buffer = src
        }
        if (!cancelled) setFileBuffer(buffer)
      } catch (err) {
        if (!cancelled) {
          setFileBuffer(null)
          setLoadError(err instanceof Error ? err.message : 'PPT 加载失败')
        }
      } finally {
        if (!cancelled) setFetching(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const measureTarget = () => {
      if (document.fullscreenElement === wrap) return wrap
      return (wrap.closest('.classroom-stage') as HTMLElement | null) ?? wrap
    }

    const update = () => {
      const fs = document.fullscreenElement === wrap
      setIsFullscreen(fs)

      const el = measureTarget()
      const width = Math.floor(el.clientWidth)
      const height = Math.floor(el.clientHeight)
      if (width <= 0 || height <= 0) return
      setStageSize((prev) =>
        prev?.width === width && prev?.height === height ? prev : { width, height },
      )
    }

    update()
    const ro = new ResizeObserver(() => update())
    ro.observe(wrap)
    const stage = wrap.closest('.classroom-stage')
    if (stage) ro.observe(stage)

    const onFullscreen = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(update)
      })
    }
    document.addEventListener('fullscreenchange', onFullscreen)

    return () => {
      ro.disconnect()
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [src])

  useEffect(() => {
    if (status === 'ready' && fontStatus === 'ready' && presentation) {
      notifySlide(slideIndexRef.current, presentation.slides.length)
    }
  }, [status, fontStatus, presentation, notifySlide])

  const handleNext = useCallback(async () => {
    if (!presentation || transitioningRef.current || isTransitioning) return

    if (!isComplete && totalSteps > 0) {
      advance()
      return
    }

    if (slideIndexRef.current >= presentation.slides.length - 1) return

    const outIdx = slideIndexRef.current
    const outSlide = presentation.slides[outIdx]
    const nextIdx = outIdx + 1

    setPrevSlideIndex(outIdx)
    notifySlide(nextIdx, presentation.slides.length)

    transitioningRef.current = true
    try {
      await startTransition(outSlide?.transition, 'forward')
    } finally {
      setPrevSlideIndex(-1)
      transitioningRef.current = false
    }
  }, [presentation, isComplete, totalSteps, advance, isTransitioning, startTransition, notifySlide])

  const handlePrev = useCallback(() => {
    if (!presentation || slideIndexRef.current <= 0) return
    notifySlide(slideIndexRef.current - 1, presentation.slides.length)
  }, [presentation, notifySlide])

  const handleGoTo = useCallback(
    (index: number) => {
      if (!presentation) return
      const clamped = Math.max(0, Math.min(index, presentation.slides.length - 1))
      setPrevSlideIndex(-1)
      notifySlide(clamped, presentation.slides.length)
    },
    [presentation, notifySlide],
  )

  const navigatePrev = useCallback(() => {
    onUserNavigateRef.current?.()
    handlePrev()
  }, [handlePrev])

  const navigateNext = useCallback(() => {
    onUserNavigateRef.current?.()
    void handleNext()
  }, [handleNext])

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest?.('.subtitle-overlay.draggable')) return
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }, [])

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current
      pointerStartRef.current = null
      if (!start || !presentation || loading || errorMessage) return

      const target = e.target as HTMLElement | null
      if (target?.closest?.('.subtitle-overlay.draggable')) return

      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      const dt = Date.now() - start.t
      if (dt > GESTURE_MAX_MS) return

      // 水平滑动翻页：左滑下一页，右滑上一页
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.15) {
        if (dx < 0) navigateNext()
        else navigatePrev()
        return
      }

      // 点击/轻触：左侧约 1/3 上一页，其余下一页（贴近放映习惯）
      if (Math.abs(dx) <= TAP_MAX_PX && Math.abs(dy) <= TAP_MAX_PX) {
        const el = canvasRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0) return
        const relX = e.clientX - rect.left
        if (relX < rect.width * 0.33) navigatePrev()
        else navigateNext()
      }
    },
    [presentation, loading, errorMessage, navigateNext, navigatePrev],
  )

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      next: () => {
        void handleNext()
      },
      prev: handlePrev,
      goTo: handleGoTo,
      getCurrentIndex: () => slideIndexRef.current,
      getSlideCount: () => presentation?.slides.length ?? 0,
      enterFullscreen: () => {
        wrapRef.current?.requestFullscreen?.()
      },
    }),
    [handleNext, handlePrev, handleGoTo, presentation?.slides.length],
  )

  const loading =
    fetching || status === 'loading' || (status === 'ready' && fontStatus === 'loading')
  const errorMessage = loadError || (parseError ? parseError.message : null)
  const scale = slideLayout?.scale ?? 1

  return (
    <div
      ref={wrapRef}
      className={['ppt-viewer-wrap', isFullscreen ? 'is-fullscreen' : ''].filter(Boolean).join(' ')}
    >
      {loading && <div className="ppt-overlay-msg">正在加载 PPT…</div>}
      {errorMessage && <div className="ppt-overlay-msg ppt-error">{errorMessage}</div>}
      <div
        ref={canvasRef}
        className="ppt-viewer-canvas ppt-touch-nav"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
      >
        {!loading &&
          !errorMessage &&
          presentation &&
          slideCount > 0 &&
          currentSlide &&
          slideLayout && (
            <div
              className="ppt-aspect-box ppt-slide-stage"
              style={{
                width: slideLayout.viewport.width,
                height: slideLayout.viewport.height,
              }}
            >
              {isTransitioning && prevSlide && (
                <div className="ppt-slide-layer ppt-slide-outgoing" style={outgoingStyle}>
                  <SlideView
                    slide={prevSlide}
                    slideSize={presentation.slideSize}
                    scale={scale}
                    fontSubstitutes={fontSubstitutes}
                  />
                </div>
              )}
              <div
                className="ppt-slide-layer ppt-slide-current"
                style={isTransitioning ? incomingStyle : undefined}
              >
                <SlideView
                  ref={slideContainerRef}
                  slide={currentSlide}
                  slideSize={presentation.slideSize}
                  scale={scale}
                  fontSubstitutes={fontSubstitutes}
                  hiddenShapeIds={currentHiddenIds}
                  className="ppt-slide-view"
                />
              </div>
            </div>
          )}
      </div>
      {slideCount > 0 && (
        <div className="ppt-slide-indicator">
          {toDisplayPage(slideIndex)} / {slideCount}
        </div>
      )}
      {overlay}
    </div>
  )
})
