import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

import { getProjectOutputDirectory, joinPath } from '@/lib/project-layout'
import { translate } from '@/lib/i18n'
import { isLikelyClockPort } from '@/lib/project-constraints'
import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'
import { projectStore } from '@/stores/project'

const MAGIC = new Uint8Array([0x41, 0x56, 0x43, 0x44])
const VERSION = 2

type WaveformSnapshot = {
  signals: readonly string[]
  tracks: Readonly<Record<string, WaveformTrackBuffer>>
  sampleRateHz: number
}

function defaultPath() {
  const project = projectStore.toSnapshot()
  const name = (project.content.name || 'waveform').replace(/[^\w.-]+/g, '_')
  return joinPath(getProjectOutputDirectory(projectStore.projectPath), `${name}.vcd.gz`)
}

export function buildWaveformVcdPayload(snapshot: WaveformSnapshot, path: string) {
  const encoder = new TextEncoder()
  const signals = snapshot.signals.filter((signal) => snapshot.tracks[signal])
  const names = signals.map((signal) => encoder.encode(signal))
  const pathBytes = encoder.encode(path)
  const sampleCount = signals.reduce(
    (maximum, signal) => Math.max(maximum, snapshot.tracks[signal]?.length ?? 0),
    0,
  )
  if (sampleCount === 0 || signals.length === 0) {
    throw new Error('No waveform samples to export')
  }
  if (signals.length > 0xffff || names.some((name) => name.length > 0xffff)) {
    throw new Error('Waveform signal metadata is too large')
  }

  const headerSize = 24 + pathBytes.length + names.reduce((size, name) => size + 3 + name.length, 0)
  const bytesPerSample = Math.ceil(signals.length / 8)
  const payload = new Uint8Array(headerSize + sampleCount * bytesPerSample)
  const view = new DataView(payload.buffer)
  payload.set(MAGIC)
  view.setUint16(4, VERSION, true)
  view.setFloat64(6, snapshot.sampleRateHz, true)
  view.setUint32(14, sampleCount, true)
  view.setUint16(18, signals.length, true)
  view.setUint32(20, pathBytes.length, true)

  let offset = 24
  payload.set(pathBytes, offset)
  offset += pathBytes.length
  names.forEach((name, index) => {
    payload[offset] = isLikelyClockPort(signals[index] ?? '') ? 1 : 0
    offset += 1
    view.setUint16(offset, name.length, true)
    offset += 2
    payload.set(name, offset)
    offset += name.length
  })

  signals.forEach((signal, signalIndex) => {
    const track = snapshot.tracks[signal]
    if (!track) return
    const oldest = (track.writeIndex - track.length + track.samples.length) % track.samples.length
    const alignedStart = sampleCount - track.length
    for (let localIndex = 0; localIndex < track.length; localIndex += 1) {
      if (!track.samples[(oldest + localIndex) % track.samples.length]) continue
      const sampleIndex = alignedStart + localIndex
      payload[offset + sampleIndex * bytesPerSample + Math.floor(signalIndex / 8)] |=
        1 << (signalIndex % 8)
    }
  })

  return payload
}

export async function exportWaveformVcd(snapshot: WaveformSnapshot) {
  const path = await save({
    defaultPath: defaultPath(),
    filters: [
      { name: translate('waveformCompressedVcdFile'), extensions: ['vcd.gz'] },
      { name: translate('waveformVcdFile'), extensions: ['vcd'] },
    ],
  })
  if (!path) return null

  await invoke('export_hardware_waveform_vcd', buildWaveformVcdPayload(snapshot, path))
  await revealItemInDir(path)
  return path
}
