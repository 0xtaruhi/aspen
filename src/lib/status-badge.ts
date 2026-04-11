export type StatusBadgeTone = 'default' | 'running' | 'success' | 'warning' | 'danger'

export function statusBadgeClass(tone: StatusBadgeTone) {
  switch (tone) {
    case 'running':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'success':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'warning':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'danger':
      return 'border-destructive/20 bg-destructive/10 text-destructive'
    case 'default':
    default:
      return 'border-border/70 bg-muted/40 text-foreground'
  }
}
