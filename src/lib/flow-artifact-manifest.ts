import type { ImplementationReportV1, SynthesisReportV1 } from './hardware-client'
import type {
  ProjectImplementationCacheSnapshot,
  ProjectSynthesisCacheSnapshot,
} from '../stores/project-model'

export type SynthesisArtifactManifestV1 = {
  version: 1
  signature: string
  report: SynthesisReportV1
}

export type ImplementationArtifactManifestV1 = {
  version: 1
  signature: string
  report: ImplementationReportV1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSynthesisReport(value: unknown): value is SynthesisReportV1 {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.version === 1 &&
    typeof value.op_id === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.top_module === 'string' &&
    typeof value.source_count === 'number' &&
    typeof value.tool_path === 'string' &&
    typeof value.elapsed_ms === 'number' &&
    typeof value.warnings === 'number' &&
    typeof value.errors === 'number' &&
    typeof value.log === 'string' &&
    Array.isArray(value.top_ports) &&
    typeof value.generated_at_ms === 'number'
  )
}

function isImplementationReport(value: unknown): value is ImplementationReportV1 {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.version === 1 &&
    typeof value.op_id === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.timing_success === 'boolean' &&
    typeof value.top_module === 'string' &&
    typeof value.source_count === 'number' &&
    typeof value.elapsed_ms === 'number' &&
    typeof value.log === 'string' &&
    Array.isArray(value.stages) &&
    isRecord(value.artifacts) &&
    typeof value.timing_report === 'string' &&
    typeof value.generated_at_ms === 'number'
  )
}

export function cloneSynthesisArtifactManifest(
  manifest: SynthesisArtifactManifestV1 | null,
): SynthesisArtifactManifestV1 | null {
  if (!manifest) {
    return null
  }

  return JSON.parse(JSON.stringify(manifest)) as SynthesisArtifactManifestV1
}

export function cloneImplementationArtifactManifest(
  manifest: ImplementationArtifactManifestV1 | null,
): ImplementationArtifactManifestV1 | null {
  if (!manifest) {
    return null
  }

  return JSON.parse(JSON.stringify(manifest)) as ImplementationArtifactManifestV1
}

export function createSynthesisArtifactManifest(
  snapshot: ProjectSynthesisCacheSnapshot | null,
): SynthesisArtifactManifestV1 | null {
  if (!snapshot) {
    return null
  }

  return {
    version: 1,
    signature: snapshot.signature,
    report: JSON.parse(JSON.stringify(snapshot.report)) as SynthesisReportV1,
  }
}

export function createImplementationArtifactManifest(
  snapshot: ProjectImplementationCacheSnapshot | null,
): ImplementationArtifactManifestV1 | null {
  if (!snapshot) {
    return null
  }

  return {
    version: 1,
    signature: snapshot.signature,
    report: JSON.parse(JSON.stringify(snapshot.report)) as ImplementationReportV1,
  }
}

export function parseSynthesisArtifactManifest(value: unknown): SynthesisArtifactManifestV1 | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    value.version !== 1 ||
    typeof value.signature !== 'string' ||
    !isSynthesisReport(value.report)
  ) {
    return null
  }

  return cloneSynthesisArtifactManifest({
    version: 1,
    signature: value.signature,
    report: value.report,
  })
}

export function parseImplementationArtifactManifest(
  value: unknown,
): ImplementationArtifactManifestV1 | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    value.version !== 1 ||
    typeof value.signature !== 'string' ||
    !isImplementationReport(value.report)
  ) {
    return null
  }

  return cloneImplementationArtifactManifest({
    version: 1,
    signature: value.signature,
    report: value.report,
  })
}
