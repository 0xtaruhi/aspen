import type { ProjectNode } from './project-model'

export type ProjectSourceFileSnapshot = {
  path: string
  content: string
}

export function collectProjectSourceFiles(
  nodes: ProjectNode[],
  parentSegments: string[] = [],
): ProjectSourceFileSnapshot[] {
  const files: ProjectSourceFileSnapshot[] = []

  for (const node of nodes) {
    const pathSegments = [...parentSegments, node.name]

    if (node.type === 'file') {
      files.push({
        path: pathSegments.join('/'),
        content: node.content ?? '',
      })
      continue
    }

    if (node.children) {
      files.push(...collectProjectSourceFiles(node.children, pathSegments))
    }
  }

  return files
}
