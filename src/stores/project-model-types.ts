import type {
  CanvasDeviceSnapshot,
  ImplementationReportV1,
  SynthesisReportV1,
} from '@/lib/hardware-client'
import type { FpgaBoardId } from '@/lib/fpga-board-catalog'
import type { FpgaDeviceId } from '@/lib/fpga-device-catalog'
import type { ImplementationSettingsSnapshot } from '@/lib/implementation-settings'
import type { ProjectConstraintSnapshot } from '@/lib/project-constraints'

export type ProjectNode = {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string
  children?: ProjectNode[]
  isOpen?: boolean
}

export type ProjectSynthesisCacheSnapshot = {
  version: 1
  signature: string
  report: SynthesisReportV1
}

export type ProjectImplementationCacheSnapshot = {
  version: 1
  signature: string
  report: ImplementationReportV1
}

export type ProjectWaveformViewSnapshot = {
  version: 1
  signalOrder: string[]
  signalColorOverrides: Record<string, string>
}

export type ProjectContentSnapshot = {
  name: string
  files: ProjectNode[]
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
  implementationSettings: ImplementationSettingsSnapshot
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  implementationCache: ProjectImplementationCacheSnapshot | null
  canvasDevices: CanvasDeviceSnapshot[]
  waveformView: ProjectWaveformViewSnapshot
}

export type ProjectWorkspaceViewSnapshot = {
  activeFileId: string
}

export type ProjectSnapshot = {
  version: 2
  content: ProjectContentSnapshot
  workspaceView: ProjectWorkspaceViewSnapshot
}

export type FileSignatureMap = Record<string, string>
