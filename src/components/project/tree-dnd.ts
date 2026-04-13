export type ProjectTreeDropMode = 'before' | 'inside' | 'after' | 'root'

export type ProjectTreeDropTarget = {
  nodeId: string | null
  mode: ProjectTreeDropMode
}
