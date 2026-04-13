import type { ProjectNode } from './project-model'

export type ProjectNodeLocation = {
  node: ProjectNode
  parent: ProjectNode | null
  container: ProjectNode[]
  index: number
}

let generatedProjectNodeIdCounter = 0

export function findNodeInTree(id: string, nodes: ProjectNode[]): ProjectNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }

    if (node.children) {
      const found = findNodeInTree(id, node.children)
      if (found) {
        return found
      }
    }
  }

  return null
}

export function findNodeLocationInTree(
  id: string,
  nodes: ProjectNode[],
  parent: ProjectNode | null = null,
): ProjectNodeLocation | null {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return {
        node,
        parent,
        container: nodes,
        index,
      }
    }
    if (node.children) {
      const found = findNodeLocationInTree(id, node.children, node)
      if (found) {
        return found
      }
    }
  }

  return null
}

export function nodeContainsDescendantId(node: ProjectNode, descendantId: string): boolean {
  if (!node.children) {
    return false
  }

  for (const child of node.children) {
    if (child.id === descendantId || nodeContainsDescendantId(child, descendantId)) {
      return true
    }
  }

  return false
}

export function clampInsertionIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length
  }

  return Math.max(0, Math.min(length, Math.trunc(index)))
}

export function removeNodeFromTree(id: string, nodes: ProjectNode[]): boolean {
  const idx = nodes.findIndex((node) => node.id === id)
  if (idx !== -1) {
    nodes.splice(idx, 1)
    return true
  }

  for (const node of nodes) {
    if (node.children && removeNodeFromTree(id, node.children)) {
      return true
    }
  }

  return false
}

export function nextProjectNodeId(): string {
  const id = `${Date.now().toString(36)}-${generatedProjectNodeIdCounter.toString(36)}`
  generatedProjectNodeIdCounter += 1
  return id
}

export function createProjectFileNode(
  name: string,
  options: { id?: string; content?: string } = {},
): ProjectNode {
  return {
    id: options.id ?? nextProjectNodeId(),
    name,
    type: 'file',
    content: options.content ?? '',
  }
}

export function createProjectFolderNode(name: string, options: { id?: string } = {}): ProjectNode {
  return {
    id: options.id ?? nextProjectNodeId(),
    name,
    type: 'folder',
    children: [],
    isOpen: true,
  }
}

export function ensureFolderChildren(node: ProjectNode): ProjectNode[] {
  return (node.children ??= [])
}
