import type { VerilogPort } from '@/lib/verilog-parser'

import { computed, readonly } from 'vue'

import { designContextStore } from '@/stores/design-context'

const signals = computed<readonly VerilogPort[]>(() => {
  return designContextStore.signals.value.map((signal) => ({
    ...signal,
  }))
})

export const signalCatalogStore = {
  signals: readonly(signals),
}
