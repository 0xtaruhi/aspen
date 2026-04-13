import { beforeEach, describe, expect, it } from 'vitest'

import type { ProjectNode, ProjectSnapshot } from './project'

import { projectStore } from './project'

function createTreeSnapshot(): ProjectSnapshot {
  return {
    version: 1,
    name: 'TreeProject',
    files: [
      {
        id: 'root',
        name: 'TreeProject',
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
          {
            id: 'folder-b',
            name: 'folder-b',
            type: 'folder',
            isOpen: true,
            children: [],
          },
        ],
      },
    ],
    activeFileId: 'top-file',
    topFileId: 'top-file',
    topModuleName: '',
    targetDeviceId: projectStore.targetDeviceId,
    targetBoardId: projectStore.targetBoardId,
    pinConstraints: {
      version: 1,
      topFileId: 'top-file',
      assignments: [],
    },
    implementationSettings: {
      version: 1,
      placeMode: projectStore.implementationSettings.placeMode,
    },
    synthesisCache: null,
    implementationCache: null,
    canvasDevices: [],
  }
}

describe('project tree operations', () => {
  beforeEach(() => {
    projectStore.clearProject()
    projectStore.loadFromSnapshot(createTreeSnapshot())
  })

  it('moves files into folders', () => {
    expect(projectStore.moveNode('top-file', 'folder-b', 0)).toBe(true)

    const folderB = projectStore.findNode('folder-b')
    expect(folderB?.type).toBe('folder')
    expect(folderB?.children?.map((child) => child.id)).toEqual(['top-file'])
    expect(folderB?.isOpen).toBe(true)

    const rootChildren = projectStore.rootNode?.children?.map((child: ProjectNode) => child.id)
    expect(rootChildren).toEqual(['folder-a', 'folder-b'])
  })

  it('moves nodes back out to the parent container at a specific index', () => {
    expect(projectStore.moveNode('nested-file', 'root', 1)).toBe(true)

    const folderA = projectStore.findNode('folder-a')
    expect(folderA?.type).toBe('folder')
    expect(folderA?.children).toEqual([])

    const rootChildren = projectStore.rootNode?.children?.map((child: ProjectNode) => child.id)
    expect(rootChildren).toEqual(['folder-a', 'nested-file', 'top-file', 'folder-b'])
  })

  it('reorders siblings within the same container', () => {
    expect(projectStore.moveNode('folder-b', 'root', 0)).toBe(true)

    const rootChildren = projectStore.rootNode?.children?.map((child: ProjectNode) => child.id)
    expect(rootChildren).toEqual(['folder-b', 'folder-a', 'top-file'])
  })

  it('rejects moving a folder into its own descendant subtree', () => {
    expect(projectStore.moveNode('folder-a', 'folder-a', 0)).toBe(false)
    expect(projectStore.moveNode('folder-a', 'nested-file', 0)).toBe(false)

    const rootChildren = projectStore.rootNode?.children?.map((child: ProjectNode) => child.id)
    expect(rootChildren).toEqual(['folder-a', 'top-file', 'folder-b'])
  })

  it('tracks inline rename state and trims committed names', () => {
    projectStore.beginRenamingNode('top-file')

    expect(projectStore.renamingNodeId).toBe('top-file')
    expect(projectStore.commitNodeRename('top-file', '  renamed-top.v  ')).toEqual({
      kind: 'renamed',
      id: 'top-file',
      nodeType: 'file',
    })
    expect(projectStore.renamingNodeId).toBe('')
    expect(projectStore.findNode('top-file')?.name).toBe('renamed-top.v')
  })

  it('clears inline rename state when a snapshot is loaded', () => {
    projectStore.beginRenamingNode('top-file')
    expect(projectStore.renamingNodeId).toBe('top-file')

    projectStore.loadFromSnapshot(createTreeSnapshot())

    expect(projectStore.renamingNodeId).toBe('')
  })

  it('creates a new file inline and opens it after commit', () => {
    const createdId = projectStore.beginCreatingFile('root')
    expect(createdId).toBeTruthy()
    expect(projectStore.renamingNodeId).toBe(createdId)
    expect(projectStore.creatingNodeId).toBe(createdId)
    expect(projectStore.activeFileId).toBe('top-file')

    const result = projectStore.commitNodeRename(createdId!, 'created-from-tree.v')
    expect(result).toEqual({
      kind: 'created',
      id: createdId,
      nodeType: 'file',
    })
    expect(projectStore.creatingNodeId).toBe('')
    expect(projectStore.findNode(createdId!)?.name).toBe('created-from-tree.v')
    expect(projectStore.activeFileId).toBe(createdId)
  })

  it('discards a new inline-created node when rename is canceled', () => {
    const createdId = projectStore.beginCreatingFile('root')
    expect(createdId).toBeTruthy()

    projectStore.cancelRenamingNode(createdId!)

    expect(projectStore.findNode(createdId!)).toBeNull()
    expect(projectStore.creatingNodeId).toBe('')
    expect(projectStore.selectedNodeId).toBe('top-file')
    expect(projectStore.activeFileId).toBe('top-file')
  })

  it('discards an inline-created folder when committed with an empty name', () => {
    const createdId = projectStore.beginCreatingFolder('root', 'New Folder')
    expect(createdId).toBeTruthy()

    const result = projectStore.commitNodeRename(createdId!, '   ')
    expect(result).toEqual({
      kind: 'discarded',
      id: createdId,
      nodeType: 'folder',
    })
    expect(projectStore.findNode(createdId!)).toBeNull()
    expect(projectStore.creatingNodeId).toBe('')
  })
})
