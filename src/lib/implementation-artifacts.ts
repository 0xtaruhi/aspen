import { getProjectOutputDirectory, joinPath } from '@/lib/project-layout'

function sanitizeSegment(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return sanitized || 'design'
}

export function getImplementationArtifactBaseName(projectName: string, topModule: string) {
  return sanitizeSegment(`${projectName}_${topModule}`)
}

export function getImplementationBitstreamPath(
  projectPath: string | null,
  projectName: string,
  topModule: string,
) {
  if (!projectPath) {
    return ''
  }

  const projectDirectory = getProjectOutputDirectory(projectPath)
  if (!projectDirectory) {
    return ''
  }

  const baseName = getImplementationArtifactBaseName(projectName, topModule)
  return joinPath(projectDirectory, `${baseName}_bit.bit`)
}
