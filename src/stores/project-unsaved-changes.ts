import { reactive } from 'vue'

export type ProjectUnsavedChangesDecision = 'save' | 'discard' | 'cancel'

type ProjectUnsavedChangesRequest = {
  title: string
  description: string
}

type ProjectUnsavedChangesState = {
  open: boolean
  title: string
  description: string
}

let pendingResolve: ((value: ProjectUnsavedChangesDecision) => void) | null = null

export const projectUnsavedChangesStore = reactive<ProjectUnsavedChangesState>({
  open: false,
  title: '',
  description: '',
})

function resolvePending(value: ProjectUnsavedChangesDecision) {
  if (!pendingResolve) {
    return
  }

  pendingResolve(value)
  pendingResolve = null
}

export function requestProjectUnsavedChanges(
  request: ProjectUnsavedChangesRequest,
): Promise<ProjectUnsavedChangesDecision> {
  resolvePending('cancel')

  projectUnsavedChangesStore.open = true
  projectUnsavedChangesStore.title = request.title
  projectUnsavedChangesStore.description = request.description

  return new Promise((resolve) => {
    pendingResolve = resolve
  })
}

export function cancelProjectUnsavedChanges() {
  projectUnsavedChangesStore.open = false
  resolvePending('cancel')
}

export function submitProjectUnsavedChanges(decision: 'save' | 'discard') {
  projectUnsavedChangesStore.open = false
  resolvePending(decision)
}
