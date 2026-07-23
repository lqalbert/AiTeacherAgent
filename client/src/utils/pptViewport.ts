/** PowerPoint 幻灯片尺寸单位为 pt（磅），渲染像素 = pt / 72 * 96 */
export function ptToPx(pt: number): number {
  return (pt / 72) * 96
}

/** 课堂放映固定画幅比例（宽:高） */
export const SLIDE_DISPLAY_ASPECT = 16 / 9

/** 右侧字幕栏最小宽度（与 CSS 保持一致） */
export const SUBTITLE_PANEL_MIN_WIDTH = 240

/** 在容器内按指定宽高比 fit-contain */
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
 * 课堂分栏布局：外框固定 16:9，内容按幻灯片原始比例等比缩小（contain），
 * 保证整页内容完整显示在 16:9 画幅内。
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

  // 外框始终 16:9，随可用区域等比缩放
  const viewport = fitSlideViewport(availableWidth, availableHeight, SLIDE_DISPLAY_ASPECT)

  const slidePxW = ptToPx(slideWidthPt)
  const slidePxH = ptToPx(slideHeightPt)

  // 内容 contain：按较小边缩放，避免裁切
  const scale = Math.min(viewport.width / slidePxW, viewport.height / slidePxH)

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
