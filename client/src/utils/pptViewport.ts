/** PowerPoint 幻灯片尺寸单位为 pt（磅），渲染像素 = pt / 72 * 96 */
export function ptToPx(pt: number): number {
  return (pt / 72) * 96
}

/** 右侧字幕栏最小宽度（与 CSS 保持一致） */
export const SUBTITLE_PANEL_MIN_WIDTH = 240

/** 在容器内按幻灯片宽高比 fit-contain */
export function fitSlideViewport(
  containerWidth: number,
  containerHeight: number,
  slideAspect: number,
): { width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || slideAspect <= 0) {
    return { width: 960, height: 540 }
  }
  const containerAspect = containerWidth / containerHeight
  if (containerAspect > slideAspect) {
    const height = Math.floor(containerHeight)
    return { width: Math.floor(height * slideAspect), height }
  }
  const width = Math.floor(containerWidth)
  return { width, height: Math.floor(width / slideAspect) }
}

/**
 * 课堂分栏布局：在「可用宽 × 可用高」内 fit-contain。
 * 优先占满高度；若宽度超出（需给字幕留位），则按宽度收缩并保持比例。
 */
export function computeSlideLayoutForSplitView(
  stageWidth: number,
  stageHeight: number,
  slideWidthPt: number,
  slideHeightPt: number,
  subtitleMinWidth = SUBTITLE_PANEL_MIN_WIDTH,
): { viewport: { width: number; height: number }; scale: number } | null {
  if (stageWidth <= 0 || stageHeight <= 0 || slideWidthPt <= 0 || slideHeightPt <= 0) {
    return null
  }

  const availableWidth = Math.max(320, stageWidth - subtitleMinWidth)
  const availableHeight = stageHeight

  const slidePxW = ptToPx(slideWidthPt)
  const slidePxH = ptToPx(slideHeightPt)
  const aspect = slidePxW / slidePxH

  const viewport = fitSlideViewport(availableWidth, availableHeight, aspect)
  const scale = viewport.height / slidePxH

  return { viewport, scale }
}

/** @deprecated 使用 computeSlideLayoutForSplitView */
export function computeSlideLayoutByHeight(
  containerHeight: number,
  slideWidthPt: number,
  slideHeightPt: number,
): { viewport: { width: number; height: number }; scale: number } | null {
  return computeSlideLayoutForSplitView(99999, containerHeight, slideWidthPt, slideHeightPt, 0)
}
