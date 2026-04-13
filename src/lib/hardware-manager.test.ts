import { describe, expect, it } from 'vitest'

import type { HardwareDeviceSnapshot, HardwarePhase } from '@/lib/hardware-client'
import type { MessageKey } from '@/lib/i18n'

import {
  buildHardwareTargets,
  resolveHardwareFlowBadgeClass,
  resolveHardwareFlowLabel,
  shouldShowHardwareFlowBadge,
} from './hardware-manager'

const translations = {
  localVlfd: 'Local VLFD',
  chip: 'Chip',
  deviceFamily: 'Family',
  architecture: 'Architecture',
  sliceCount: 'Slices',
  lut4Count: 'LUT4',
  ffCount: 'FF',
  bramCount: 'BRAM',
  bramCountValue: '8 blocks / 4608 bits',
  availableIo: 'Available IO',
  availableIoValue: '11 inputs / 5 outputs / 1 clocks / P77',
  descriptionLabel: 'Description',
  smimsVersion: 'SMIMS',
  fifoWords: 'FIFO',
  flashBlocks: 'Flash Blocks',
  flashBlockSize: 'Flash Block Size',
  flashClusterSize: 'Flash Cluster Size',
  bytesValue: '1024 bytes',
  veriComm: 'VeriComm',
  enabled: 'Enabled',
  unavailable: 'Unavailable',
  fpgaProgrammed: 'Programmed',
  pcbConnected: 'Connected',
  yes: 'Yes',
  no: 'No',
  probing: 'Probing',
  ready: 'Ready',
  generating: 'Generating',
  bitstreamReady: 'Bitstream Ready',
  programming: 'Programming',
  error: 'Error',
  disconnected: 'Disconnected',
} as const

function t(key: MessageKey) {
  return translations[key as keyof typeof translations] ?? key
}

function createHardwareStatus(): HardwareDeviceSnapshot {
  return {
    board: 'FDP3P7',
    description: 'Reference board',
    config: {
      smims_version: '1.0',
      fifo_words: 512,
      flash_total_block: 64,
      flash_block_size: 1024,
      flash_cluster_size: 4096,
      vericomm_enabled: true,
      programmed: true,
      pcb_connected: true,
    },
  }
}

describe('hardware manager helpers', () => {
  it('builds a single-host hardware target tree with device details', () => {
    const targets = buildHardwareTargets(createHardwareStatus(), 'fdp3p7', t)

    expect(targets).toHaveLength(1)
    expect(targets[0].children?.[0].name).toBe('FDP3P7')
    expect(targets[0].children?.[0].status).toBe('ready')
    expect(targets[0].children?.[0].details?.Chip).toBe('FDP3P7')
  })

  it('maps flow phases to labels and badge classes', () => {
    expect(resolveHardwareFlowLabel('probing', t)).toBe('Probing')
    expect(resolveHardwareFlowLabel('bitstream_ready', t)).toBe('Bitstream Ready')
    expect(resolveHardwareFlowBadgeClass('bitstream_ready')).toContain('text-green-600')
    expect(resolveHardwareFlowBadgeClass('error')).toContain('text-destructive')
  })

  it('shows the toolbar badge only for active or terminal flow states', () => {
    const visiblePhases: HardwarePhase[] = [
      'probing',
      'generating',
      'bitstream_ready',
      'programming',
      'error',
      'device_disconnected',
    ]

    for (const phase of visiblePhases) {
      expect(shouldShowHardwareFlowBadge(phase)).toBe(true)
    }

    expect(shouldShowHardwareFlowBadge('idle')).toBe(false)
    expect(shouldShowHardwareFlowBadge('device_ready')).toBe(false)
  })
})
