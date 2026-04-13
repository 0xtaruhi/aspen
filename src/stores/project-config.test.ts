import { describe, expect, it } from 'vitest'

import { defaultFpgaBoardId } from '@/lib/fpga-board-catalog'
import { defaultFpgaDeviceId } from '@/lib/fpga-device-catalog'
import {
  cloneImplementationSettings,
  defaultImplementationSettings,
} from '@/lib/implementation-settings'

import type { ProjectNode } from './project-model'

import {
  clearPinConstraint,
  clearPinConstraints,
  setImplementationPlaceMode,
  setPinConstraint,
  setTopFile,
  setTopModuleName,
  type ProjectConfigStoreLike,
} from './project-config'
import { findNodeInTree } from './project-tree'

type ProjectConfigStoreTestDouble = ProjectConfigStoreLike & {
  files: ProjectNode[]
}

function createStore(): ProjectConfigStoreTestDouble {
  const files: ProjectNode[] = [
    {
      id: 'root',
      name: 'ConfigProject',
      type: 'folder',
      isOpen: true,
      children: [
        {
          id: 'top-a',
          name: 'top_a.v',
          type: 'file',
          content: 'module top_a; endmodule',
        },
        {
          id: 'top-b',
          name: 'top_b.sv',
          type: 'file',
          content: 'module top_b; endmodule',
        },
        {
          id: 'notes',
          name: 'notes.txt',
          type: 'file',
          content: 'not hardware',
        },
      ],
    },
  ]

  return {
    files,
    topFileId: 'top-a',
    topModuleName: 'top_a',
    targetDeviceId: defaultFpgaDeviceId,
    targetBoardId: defaultFpgaBoardId,
    pinConstraints: {
      version: 1,
      topFileId: 'top-a',
      assignments: [
        {
          portName: 'clk',
          pinId: 'P77',
          boardFunction: 'CLK',
        },
      ],
    },
    implementationSettings: cloneImplementationSettings(defaultImplementationSettings),
    findNode(id: string, nodes?: ProjectNode[]) {
      return findNodeInTree(id, nodes ?? this.files)
    },
  }
}

describe('project config helpers', () => {
  it('retargets the top file and clears stale top-specific state', () => {
    const store = createStore()

    setTopFile(store, 'top-b')

    expect(store.topFileId).toBe('top-b')
    expect(store.topModuleName).toBe('')
    expect(store.pinConstraints).toEqual({
      version: 1,
      topFileId: 'top-b',
      assignments: [],
    })
  })

  it('ignores non-hardware files when setting the top file', () => {
    const store = createStore()

    setTopFile(store, 'notes')

    expect(store.topFileId).toBe('top-a')
    expect(store.topModuleName).toBe('top_a')
    expect(store.pinConstraints.assignments).toHaveLength(1)
  })

  it('upserts and clears pin constraints against the selected top file', () => {
    const store = createStore()

    setPinConstraint(store, 'top-a', {
      portName: 'led',
      pinId: 'P7',
    })
    setPinConstraint(store, 'top-a', {
      portName: 'clk',
      pinId: 'P150',
      boardFunction: 'ALT_CLK',
    })

    expect(
      Object.fromEntries(
        store.pinConstraints.assignments.map((entry) => [entry.portName, entry.pinId]),
      ),
    ).toEqual({
      clk: 'P150',
      led: 'P7',
    })

    clearPinConstraint(store, 'top-a', 'led')

    expect(store.pinConstraints.assignments).toEqual([
      {
        portName: 'clk',
        pinId: 'P150',
        boardFunction: 'ALT_CLK',
      },
    ])

    clearPinConstraints(store)

    expect(store.pinConstraints).toEqual({
      version: 1,
      topFileId: 'top-a',
      assignments: [],
    })
  })

  it('trims top module names and updates place mode in place', () => {
    const store = createStore()

    setTopModuleName(store, '  custom_top  ')
    setImplementationPlaceMode(store, 'bounding_box')

    expect(store.topModuleName).toBe('custom_top')
    expect(store.implementationSettings).toEqual({
      version: 1,
      placeMode: 'bounding_box',
    })
  })
})
