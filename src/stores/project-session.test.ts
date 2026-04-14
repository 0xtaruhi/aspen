import { describe, expect, it } from 'vitest'

import { defaultFpgaBoardId } from '@/lib/fpga-board-catalog'
import { defaultFpgaDeviceId } from '@/lib/fpga-device-catalog'
import { defaultImplementationSettings } from '@/lib/implementation-settings'

import {
  buildEmptyProjectSession,
  buildLoadedProjectSession,
  buildTemplateProjectSession,
} from './project-session'

describe('project session helpers', () => {
  it('normalizes loaded snapshots and retargets stale pin constraints', () => {
    const session = buildLoadedProjectSession({
      version: 2,
      content: {
        name: 'LoadedProject',
        files: [
          {
            id: 'root',
            name: 'LoadedProject',
            type: 'folder',
            isOpen: true,
            children: [
              {
                id: 'top-file',
                name: 'top.v',
                type: 'file',
                content: 'module top(input clk, output led); assign led = clk; endmodule',
              },
            ],
          },
        ],
        topFileId: 'top-file',
        topModuleName: 'top',
        pinConstraints: {
          version: 1,
          topFileId: 'stale-top-file',
          assignments: [
            {
              portName: 'clk',
              pinId: 'P77',
              boardFunction: 'CLK',
            },
          ],
        },
      },
      workspaceView: {
        activeFileId: 'missing-file',
      },
    })

    expect(session.activeFileId).toBe('top-file')
    expect(session.selectedNodeId).toBe('top-file')
    expect(session.renamingNodeId).toBe('')
    expect(session.creatingNodeId).toBe('')
    expect(session.pinConstraints.topFileId).toBe('top-file')
    expect(session.topModuleName).toBe('top')
  })

  it('falls back when persisted active or top ids point to folders', () => {
    const session = buildLoadedProjectSession({
      version: 2,
      content: {
        name: 'LoadedProject',
        files: [
          {
            id: 'root',
            name: 'LoadedProject',
            type: 'folder',
            isOpen: true,
            children: [
              {
                id: 'nested-folder',
                name: 'Nested',
                type: 'folder',
                isOpen: true,
                children: [
                  {
                    id: 'top-file',
                    name: 'top.v',
                    type: 'file',
                    content: 'module top(input clk, output led); assign led = clk; endmodule',
                  },
                ],
              },
            ],
          },
        ],
        topFileId: 'nested-folder',
        topModuleName: 'nested_folder',
        pinConstraints: {
          version: 1,
          topFileId: 'nested-folder',
          assignments: [],
        },
      },
      workspaceView: {
        activeFileId: 'root',
      },
    })

    expect(session.activeFileId).toBe('top-file')
    expect(session.selectedNodeId).toBe('top-file')
    expect(session.topFileId).toBe('top-file')
    expect(session.topModuleName).toBe('')
    expect(session.pinConstraints.topFileId).toBe('top-file')
  })

  it('builds a fresh template-backed project session with defaults', () => {
    const session = buildTemplateProjectSession('Blink', 'blinky')

    expect(session.targetDeviceId).toBe(defaultFpgaDeviceId)
    expect(session.targetBoardId).toBe(defaultFpgaBoardId)
    expect(session.implementationSettings).toEqual(defaultImplementationSettings)
    expect(session.synthesisCache).toBeNull()
    expect(session.implementationCache).toBeNull()
    expect(session.canvasDevices).toEqual([])
  })

  it('builds an empty workspace session with all transient state cleared', () => {
    const session = buildEmptyProjectSession()

    expect(session.files).toEqual([])
    expect(session.activeFileId).toBe('')
    expect(session.selectedNodeId).toBe('')
    expect(session.topFileId).toBe('')
    expect(session.topModuleName).toBe('')
    expect(session.canvasDevices).toEqual([])
  })
})
