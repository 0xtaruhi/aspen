import { describe, expect, it } from 'vitest'

import type { CanvasDeviceType } from '@/lib/hardware-client'
import type { ProjectNode } from '@/stores/project'

import {
  createBundledExampleSnapshot,
  projectStarterCatalog,
  type ProjectExampleId,
} from './project-starters'

const supportedDeviceTypes: CanvasDeviceType[] = [
  'led',
  'switch',
  'button',
  'dip_switch_bank',
  'led_bar',
  'audio_pwm',
  'quadrature_encoder',
  'matrix_keypad',
  'uart_terminal',
  'hd44780_lcd',
  'vga_display',
  'segment_display',
  'led_matrix',
]

function collectFiles(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.flatMap((node) =>
    node.type === 'file' ? [node] : collectFiles(node.children ?? []),
  )
}

describe('bundled project starters', () => {
  const exampleEntries = projectStarterCatalog.filter((entry) => entry.starter.kind === 'example')

  it('keeps three lightweight templates and twelve complete examples', () => {
    expect(projectStarterCatalog.filter((entry) => entry.category === 'template')).toHaveLength(3)
    expect(exampleEntries).toHaveLength(12)
  })

  it.each(exampleEntries)('hydrates $id into an editable project snapshot', (entry) => {
    const exampleId = (entry.starter as { kind: 'example'; exampleId: ProjectExampleId }).exampleId
    const snapshot = createBundledExampleSnapshot(exampleId, 'CopiedExample')
    const sourceFiles = collectFiles(snapshot.content.files)

    expect(snapshot.version).toBe(2)
    expect(snapshot.content.name).toBe('CopiedExample')
    expect(snapshot.content.files[0]?.name).toBe('CopiedExample')
    expect(snapshot.content.topModuleName).not.toBe('')
    expect(sourceFiles.length).toBeGreaterThan(0)
    expect(sourceFiles.every((file) => (file.content ?? '').includes('module '))).toBe(true)
    expect(snapshot.content.synthesisCache).toBeNull()
    expect(snapshot.content.implementationCache).toBeNull()
    expect(snapshot.content.canvasDevices.length).toBeGreaterThan(0)
  })

  it('covers every virtual-device type across the example catalog', () => {
    const coveredTypes = new Set<CanvasDeviceType>()
    for (const entry of exampleEntries) {
      if (entry.starter.kind !== 'example') continue
      const snapshot = createBundledExampleSnapshot(entry.starter.exampleId, entry.suggestedName)
      for (const device of snapshot.content.canvasDevices) {
        coveredTypes.add(device.type)
      }
    }

    expect([...coveredTypes].sort()).toEqual([...supportedDeviceTypes].sort())
  })

  it('keeps the GPIO controls lab direct and stateless', () => {
    const snapshot = createBundledExampleSnapshot('device-labs/gpio-controls', 'GPIOControlsLab')
    const source = collectFiles(snapshot.content.files)[0]?.content ?? ''
    const devices = new Map(snapshot.content.canvasDevices.map((device) => [device.label, device]))

    expect(source).toContain('assign inverted_led = invert_switch;')
    expect(source).toContain("assign led_bar = clear_button ? 8'h00")
    expect(source).not.toContain('always @')
    expect(devices.get('Invert')?.state.binding).toEqual({
      kind: 'single',
      signal: 'invert_switch',
    })
    expect(devices.get('Clear')?.state.binding).toEqual({
      kind: 'single',
      signal: 'clear_button',
    })
    expect(devices.get('Inverted')?.state.binding).toEqual({
      kind: 'single',
      signal: 'inverted_led',
    })
  })
})
