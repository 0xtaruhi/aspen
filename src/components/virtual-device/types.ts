export type IndexedSignalBus = {
  baseName: string
  label: string
  width: number
  signals: Array<string | null>
}

export type IndexedBusBindingGroup = {
  key: string
  label: string
  width: number
  slotOffset: number
  keywords: readonly string[]
}
