import type { ProjectNode } from '@/stores/project-model'

export function findProjectNodePathById(
  nodes: ProjectNode[],
  targetId: string,
  parentSegments: string[] = [],
): string {
  for (const node of nodes) {
    const pathSegments = [...parentSegments, node.name]

    if (node.id === targetId) {
      return pathSegments.join('/')
    }

    if (node.children) {
      const childPath = findProjectNodePathById(node.children, targetId, pathSegments)
      if (childPath) {
        return childPath
      }
    }
  }

  return ''
}
