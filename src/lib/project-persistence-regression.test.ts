import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { ProjectSnapshot } from '@/stores/project'

function createLedDevice(id: string, label: string): CanvasDeviceSnapshot {
  return {
    id,
    type: 'led',
    x: 40,
    y: 60,
    label,
    state: {
      is_on: false,
      color: '#ef4444',
      binding: {
        kind: 'single',
        signal: `${id}_signal`,
      },
      config: {
        kind: 'none',
      },
      data: {
        kind: 'none',
      },
    },
  }
}

function createProjectSnapshot(canvasDevices: CanvasDeviceSnapshot[]): ProjectSnapshot {
  return {
    version: 2,
    content: {
      name: 'CanvasRegressionProject',
      files: [
        {
          id: 'root',
          name: 'CanvasRegressionProject',
          type: 'folder',
          isOpen: true,
          children: [
            {
              id: 'top',
              name: 'Top.v',
              type: 'file',
              content: "module Top(output wire led); assign led = 1'b0; endmodule",
            },
          ],
        },
      ],
      topFileId: 'top',
      topModuleName: 'Top',
      targetDeviceId: 'FDP3P7',
      targetBoardId: 'FDP3P7_REFERENCE',
      pinConstraints: {
        version: 1,
        topFileId: 'top',
        assignments: [],
      },
      implementationSettings: {
        version: 1,
        placeMode: 'bounding_box',
      },
      synthesisCache: null,
      implementationCache: null,
      canvasDevices,
      waveformView: {
        version: 1,
        signalOrder: [],
        signalColorOverrides: {},
      },
    },
    workspaceView: {
      activeFileId: 'top',
    },
  }
}

describe('project persistence regression', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('replaces runtime canvas devices from the loaded snapshot instead of a raced global canvas state', async () => {
    const loadedCanvasDevices = [createLedDevice('new-led', 'New LED')]
    const racedCanvasDevices = [createLedDevice('old-led', 'Old LED')]
    const replaceCanvasDevices = vi.fn(async (_devices: readonly CanvasDeviceSnapshot[]) => true)
    const rememberProject = vi.fn()
    const snapshot = createProjectSnapshot(loadedCanvasDevices)

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (command: string, args?: { path?: string }) => {
        if (command !== 'read_project_file') {
          throw new Error(`unexpected command: ${command}`)
        }

        if (args?.path === '/tmp/CanvasRegression/aspen.project.json') {
          return JSON.stringify(snapshot)
        }

        throw new Error('not found')
      }),
    }))

    vi.doMock('@/stores/hardware', () => ({
      hardwareStore: {
        replaceCanvasDevices,
      },
    }))

    vi.doMock('@/stores/recent-projects', () => ({
      recentProjectsStore: {
        rememberProject,
      },
    }))

    const { loadProjectFromPath } = await import('./project-persistence')
    const { projectStore } = await import('@/stores/project')
    const { projectCanvasStore } = await import('@/stores/project-canvas')

    const originalLoadFromSnapshot = projectStore.loadFromSnapshot.bind(projectStore)
    vi.spyOn(projectStore, 'loadFromSnapshot').mockImplementation((loaded, options) => {
      originalLoadFromSnapshot(loaded, options)
      projectCanvasStore.setCanvasDevices(racedCanvasDevices)
    })

    await loadProjectFromPath('/tmp/CanvasRegression/aspen.project.json')

    expect(replaceCanvasDevices).toHaveBeenCalledTimes(1)
    const replacedDevices = replaceCanvasDevices.mock.calls[0]![0]
    expect(replacedDevices).toEqual(loadedCanvasDevices)
    expect(rememberProject).toHaveBeenCalledWith(
      '/tmp/CanvasRegression/aspen.project.json',
      'CanvasRegressionProject',
    )
  })

  it('normalizes missing persisted canvas devices before syncing them to the runtime', async () => {
    const replaceCanvasDevices = vi.fn(async (_devices: readonly CanvasDeviceSnapshot[]) => true)
    const rememberProject = vi.fn()
    const rawSnapshot = {
      version: 2,
      content: {
        name: 'CanvasRegressionProject',
        files: [
          {
            id: 'root',
            name: 'CanvasRegressionProject',
            type: 'folder',
            isOpen: true,
            children: [
              {
                id: 'top',
                name: 'Top.v',
                type: 'file',
                content: "module Top(output wire led); assign led = 1'b0; endmodule",
              },
            ],
          },
        ],
        topFileId: 'top',
        topModuleName: 'Top',
        targetDeviceId: 'FDP3P7',
        targetBoardId: 'FDP3P7_REFERENCE',
        pinConstraints: {
          version: 1,
          topFileId: 'top',
          assignments: [],
        },
        implementationSettings: {
          version: 1,
          placeMode: 'bounding_box',
        },
        synthesisCache: null,
        implementationCache: null,
      },
      workspaceView: {
        activeFileId: 'top',
      },
    }

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(async (command: string, args?: { path?: string }) => {
        if (command !== 'read_project_file') {
          throw new Error(`unexpected command: ${command}`)
        }

        if (args?.path === '/tmp/CanvasRegression/aspen.project.json') {
          return JSON.stringify(rawSnapshot)
        }

        throw new Error('not found')
      }),
    }))

    vi.doMock('@/stores/hardware', () => ({
      hardwareStore: {
        replaceCanvasDevices,
      },
    }))

    vi.doMock('@/stores/recent-projects', () => ({
      recentProjectsStore: {
        rememberProject,
      },
    }))

    const { loadProjectFromPath } = await import('./project-persistence')

    await expect(loadProjectFromPath('/tmp/CanvasRegression/aspen.project.json')).resolves.toBe(
      true,
    )

    expect(replaceCanvasDevices).toHaveBeenCalledTimes(1)
    expect(replaceCanvasDevices).toHaveBeenCalledWith([])
    expect(rememberProject).toHaveBeenCalledWith(
      '/tmp/CanvasRegression/aspen.project.json',
      'CanvasRegressionProject',
    )
  })
})
