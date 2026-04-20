import type { ProjectNode } from './project-model'

export type ProjectFileEntry = {
  node: ProjectNode
  path: string
}

export type ProjectSourceFileSnapshot = {
  path: string
  content: string
}

export function collectProjectFileEntries(
  nodes: readonly ProjectNode[],
  parentSegments: readonly string[] = [],
): ProjectFileEntry[] {
  const files: ProjectFileEntry[] = []

  for (const node of nodes) {
    const pathSegments = [...parentSegments, node.name]
    const path = pathSegments.join('/')

    if (node.type === 'file') {
      files.push({
        node,
        path,
      })
      continue
    }

    if (node.children) {
      files.push(...collectProjectFileEntries(node.children, pathSegments))
    }
  }

  return files
}

export function collectProjectSourceFilePaths(nodes: readonly ProjectNode[]): string[] {
  return collectProjectFileEntries(nodes).map((file) => file.path)
}

export function collectProjectSourceFiles(
  nodes: readonly ProjectNode[],
): ProjectSourceFileSnapshot[] {
  return collectProjectFileEntries(nodes).map((file) => ({
    path: file.path,
    content: file.node.content ?? '',
  }))
}
