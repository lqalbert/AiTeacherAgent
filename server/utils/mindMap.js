/** @typedef {{ label: string, children?: MindMapNode[] }} MindMapNode */

const MAX_DEPTH = 4
const MAX_LABEL_LEN = 28

/** @param {unknown} raw @param {string} [fallbackTitle] @returns {MindMapNode} */
export function normalizeMindMap(raw, fallbackTitle = '本节课') {
  if (!raw || typeof raw !== 'object') {
    return { label: fallbackTitle, children: [] }
  }

  /** @param {Record<string, unknown>} node @param {number} depth */
  function norm(node, depth = 0) {
    const label = truncateLabel(String(node.label || node.title || node.name || '').trim() || '未命名')
    if (depth >= MAX_DEPTH) return { label, children: [] }

    const rawChildren = Array.isArray(node.children)
      ? node.children
      : Array.isArray(node.topics)
        ? node.topics
        : []

    const seen = new Set()
    const children = rawChildren
      .map((c) => norm(/** @type {Record<string, unknown>} */ (c), depth + 1))
      .filter((c) => c.label && c.label !== '未命名')
      .filter((c) => {
        const key = c.label.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    return { label, children }
  }

  const root = norm(/** @type {Record<string, unknown>} */ (raw))
  if (!root.label || root.label === '未命名') root.label = fallbackTitle
  return root
}

/** @param {string} label */
function truncateLabel(label) {
  if (label.length <= MAX_LABEL_LEN) return label
  return `${label.slice(0, MAX_LABEL_LEN - 1)}…`
}

/** @param {MindMapNode} node @param {number} [depth] @returns {string[]} */
export function mindMapToMarkdownLines(node, depth = 0) {
  const indent = '  '.repeat(depth)
  const lines = [`${indent}- ${node.label}`]
  for (const child of node.children || []) {
    lines.push(...mindMapToMarkdownLines(child, depth + 1))
  }
  return lines
}

/** @param {MindMapNode} node @param {number} [level] @returns {Array<{ text: string, level: number }>} */
export function mindMapToBulletItems(node, level = 0) {
  const items = [{ text: node.label, level }]
  for (const child of node.children || []) {
    items.push(...mindMapToBulletItems(child, level + 1))
  }
  return items
}

/** @param {MindMapNode} node @returns {number} */
export function countMindMapNodes(node) {
  let n = 1
  for (const child of node.children || []) {
    n += countMindMapNodes(child)
  }
  return n
}
