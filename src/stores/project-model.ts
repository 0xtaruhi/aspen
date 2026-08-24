import type {
  ProjectContentSnapshot,
  ProjectSnapshot,
  ProjectWorkspaceViewSnapshot,
} from './project-model-types'

export type {
  FileSignatureMap,
  ProjectContentSnapshot,
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectSynthesisCacheSnapshot,
  ProjectWaveformViewSnapshot,
  ProjectWorkspaceViewSnapshot,
} from './project-model-types'

export {
  buildFileSignatureMap,
  createFileSignature,
  findFirstFileId,
  isHardwareSourceFile,
  parseTopSignals,
  resolveTopFileId,
} from './project-model-files'

export {
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  cloneProjectWaveformViewSnapshot,
  emptyProjectWaveformViewSnapshot,
  normalizeProjectCanvasDevices,
  normalizeProjectImplementationCacheSnapshot,
  normalizeProjectSnapshot,
  normalizeProjectSynthesisCacheSnapshot,
  normalizeProjectWaveformViewSnapshot,
} from './project-model-validation'

export function composeProjectSnapshot(
  contentSnapshot: ProjectContentSnapshot,
  workspaceViewSnapshot: ProjectWorkspaceViewSnapshot,
): ProjectSnapshot {
  return {
    version: 2,
    content: contentSnapshot,
    workspaceView: workspaceViewSnapshot,
  }
}

export function splitProjectSnapshot(snapshot: ProjectSnapshot): {
  contentSnapshot: ProjectContentSnapshot
  workspaceViewSnapshot: ProjectWorkspaceViewSnapshot
} {
  return {
    contentSnapshot: snapshot.content,
    workspaceViewSnapshot: snapshot.workspaceView,
  }
}

export function serializeProjectContentSnapshot(snapshot: ProjectContentSnapshot) {
  return JSON.stringify(snapshot)
}
