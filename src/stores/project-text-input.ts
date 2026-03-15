import { reactive } from 'vue'

type ProjectTextInputRequest = {
  title: string
  confirmLabel: string
  initialValue?: string
  description?: string
}

type ProjectTextInputState = {
  open: boolean
  title: string
  confirmLabel: string
  description: string
  value: string
}

let pendingResolve: ((value: string | null) => void) | null = null

export const projectTextInputStore = reactive<ProjectTextInputState>({
  open: false,
  title: '',
  confirmLabel: '',
  description: '',
  value: '',
})

function resolvePending(value: string | null) {
  if (!pendingResolve) {
    return
  }

  pendingResolve(value)
  pendingResolve = null
}

export function requestProjectTextInput(request: ProjectTextInputRequest): Promise<string | null> {
  resolvePending(null)

  projectTextInputStore.open = true
  projectTextInputStore.title = request.title
  projectTextInputStore.confirmLabel = request.confirmLabel
  projectTextInputStore.description = request.description ?? ''
  projectTextInputStore.value = request.initialValue ?? ''

  return new Promise((resolve) => {
    pendingResolve = resolve
  })
}

export function cancelProjectTextInput() {
  projectTextInputStore.open = false
  resolvePending(null)
}

export function submitProjectTextInput() {
  const value = projectTextInputStore.value.trim()
  if (!value) {
    return
  }

  projectTextInputStore.open = false
  resolvePending(value)
}
