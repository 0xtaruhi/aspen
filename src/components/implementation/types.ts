export type ImplementationBlockingAction = {
  label: string
  onClick: () => unknown
  variant: 'default' | 'outline'
}

export type ImplementationBlockingStateViewModel = {
  title: string
  description: string
  actions: ImplementationBlockingAction[]
  showRecentProjects: boolean
}

export type ImplementationReadinessChecklistItem = {
  key: string
  label: string
  ready: boolean
}
