function sanitizeSegment(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return sanitized || 'design'
}

function getProjectDirectory(projectPath: string) {
  const normalized = projectPath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : ''
}

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      const normalized = part.replace(/\\/g, '/')
      if (index === 0) {
        return normalized.replace(/\/+$/g, '')
      }
      return normalized.replace(/^\/+/g, '').replace(/\/+$/g, '')
    })
    .join('/')
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

  const projectDirectory = getProjectDirectory(projectPath)
  if (!projectDirectory) {
    return ''
  }

  const baseName = getImplementationArtifactBaseName(projectName, topModule)
  return joinPath(projectDirectory, '.aspen', 'fde', baseName, `${baseName}_bit.bit`)
}
