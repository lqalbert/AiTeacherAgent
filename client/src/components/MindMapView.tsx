import type { MindMapNode } from '../types'

type Props = {
  root: MindMapNode
}

function MindMapBranch({ node, isRoot = false, depth = 0 }: { node: MindMapNode; isRoot?: boolean; depth?: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0

  return (
    <div className={`mind-map-node${isRoot ? ' mind-map-root' : ''} mind-map-depth-${Math.min(depth, 4)}`}>
      <div className="mind-map-label">{node.label}</div>
      {hasChildren && (
        <div className="mind-map-children">
          {node.children!.map((child, index) => (
            <MindMapBranch key={`${child.label}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function MindMapView({ root }: Props) {
  if (!root?.label) return null

  return (
    <div className="mind-map">
      <MindMapBranch node={root} isRoot />
    </div>
  )
}
