import { reactive } from 'vue'

export type RecentProjectEntry = {
  path: string
  name: string
  openedAtMs: number
}

const STORAGE_KEY = 'aspen-recent-projects'
const MAX_RECENT_PROJECTS = 8

function getFallbackName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const filename = segments[segments.length - 1] || path
  if (/^aspen\.project\.json$/i.test(filename)) {
    return segments[segments.length - 2] || 'project'
  }

  return filename.replace(/\.aspen\.json$/i, '').replace(/\.json$/i, '')
}

function isRecentProjectEntry(value: unknown): value is RecentProjectEntry {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.openedAtMs === 'number' &&
    Number.isFinite(candidate.openedAtMs)
  )
}

function readStoredRecentProjects(): RecentProjectEntry[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isRecentProjectEntry).slice(0, MAX_RECENT_PROJECTS)
  } catch (_) {
    return []
  }
}

function writeStoredRecentProjects(entries: RecentProjectEntry[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (_) {
    /* no-op */
  }
}

const state = reactive({
  entries: readStoredRecentProjects(),
})

function replaceEntries(entries: RecentProjectEntry[]) {
  state.entries.splice(0, state.entries.length, ...entries)
  writeStoredRecentProjects(state.entries)
}

export const recentProjectsStore = {
  state,

  rememberProject(path: string, name?: string | null) {
    const normalizedPath = path.trim()
    if (!normalizedPath) {
      return
    }

    const nextEntry: RecentProjectEntry = {
      path: normalizedPath,
      name: (name?.trim() || getFallbackName(normalizedPath)).trim(),
      openedAtMs: Date.now(),
    }

    const remaining = state.entries.filter((entry) => entry.path !== normalizedPath)
    replaceEntries([nextEntry, ...remaining].slice(0, MAX_RECENT_PROJECTS))
  },

  removeProject(path: string) {
    const normalizedPath = path.trim()
    if (!normalizedPath) {
      return
    }

    replaceEntries(state.entries.filter((entry) => entry.path !== normalizedPath))
  },
}
