export const ASPEN_PROJECT_FILENAME = 'aspen.project.json'
export const ASPEN_SOURCES_DIRNAME = 'src'
export const ASPEN_OUTPUT_DIRNAME = 'output'
export const ASPEN_INTERNAL_DIRNAME = '.aspen'

export function normalizePath(path: string) {
  return path.replace(/\\/g, '/')
}

export function joinPath(...parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part, index) => {
      const normalized = normalizePath(part)
      if (index === 0) {
        return normalized.replace(/\/+$/g, '')
      }

      return normalized.replace(/^\/+/g, '').replace(/\/+$/g, '')
    })
    .join('/')
}

export function getDirectoryName(path: string | null) {
  if (!path) {
    return null
  }

  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : null
}

export function getProjectRootDirectory(projectPath: string | null) {
  return getDirectoryName(projectPath)
}

export function getProjectMetadataPath(projectPath: string | null) {
  if (projectPath) {
    return projectPath
  }

  return ASPEN_PROJECT_FILENAME
}

export function getProjectSourcesDirectory(projectPath: string | null) {
  const projectRoot = getProjectRootDirectory(projectPath)
  return projectRoot ? joinPath(projectRoot, ASPEN_SOURCES_DIRNAME) : null
}

export function getProjectOutputDirectory(projectPath: string | null) {
  const projectRoot = getProjectRootDirectory(projectPath)
  return projectRoot ? joinPath(projectRoot, ASPEN_OUTPUT_DIRNAME) : null
}
