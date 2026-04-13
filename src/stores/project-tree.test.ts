import { describe, expect, it } from 'vitest'

import type { ProjectNode } from './project-model'

import {
  clampInsertionIndex,
  createProjectFileNode,
  createProjectFolderNode,
  ensureFolderChildren,
  findNodeLocationInTree,
  nodeContainsDescendantId,
  removeNodeFromTree,
} from './project-tree'

function createTree(): ProjectNode[] {
  return [
    {
      id: 'root',
      name: 'root',
      type: 'folder',
      isOpen: true,
      children: [
        {
          id: 'folder-a',
          name: 'folder-a',
          type: 'folder',
          isOpen: true,
          children: [
            {
              id: 'nested-file',
              name: 'nested-file.v',
              type: 'file',
              content: 'module nested_file; endmodule',
            },
          ],
        },
        {
          id: 'top-file',
          name: 'top-file.v',
          type: 'file',
          content: 'module top_file; endmodule',
        },
      ],
    },
  ]
}

describe('project tree helpers', () => {
  it('finds node locations across nested containers', () => {
    const location = findNodeLocationInTree('nested-file', createTree())

    expect(location?.parent?.id).toBe('folder-a')
    expect(location?.container.map((node) => node.id)).toEqual(['nested-file'])
    expect(location?.index).toBe(0)
  })

  it('detects descendant relationships and removes nodes in place', () => {
    const tree = createTree()
    const root = tree[0]
    const folderA = root.children?.[0]

    expect(folderA).toBeTruthy()
    expect(nodeContainsDescendantId(folderA!, 'nested-file')).toBe(true)
    expect(removeNodeFromTree('nested-file', tree)).toBe(true)
    expect(nodeContainsDescendantId(folderA!, 'nested-file')).toBe(false)
  })

  it('creates file/folder nodes and normalizes insertion indices', () => {
    const file = createProjectFileNode('new.v', { id: 'file-1', content: 'module new; endmodule' })
    const folder = createProjectFolderNode('new-folder', { id: 'folder-1' })

    expect(file).toMatchObject({ id: 'file-1', name: 'new.v', type: 'file' })
    expect(folder).toMatchObject({ id: 'folder-1', name: 'new-folder', type: 'folder' })
    expect(ensureFolderChildren(folder)).toEqual([])
    expect(clampInsertionIndex(-3, 4)).toBe(0)
    expect(clampInsertionIndex(99, 4)).toBe(4)
  })
})
