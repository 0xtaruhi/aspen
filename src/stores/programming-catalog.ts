import { computed, readonly } from 'vue'

import { implementationCatalogStore } from '@/stores/implementation-catalog'

const defaultBitstreamPath = computed(() => {
  return implementationCatalogStore.currentImplementationBitstreamPath.value
})

const staleBitstreamPath = computed(() => {
  if (!implementationCatalogStore.hasStaleImplementationReport.value) {
    return ''
  }

  return implementationCatalogStore.latestImplementationBitstreamPath.value
})

const hasDefaultBitstream = computed(() => defaultBitstreamPath.value.length > 0)
const hasStaleBitstream = computed(() => staleBitstreamPath.value.length > 0)

export const programmingCatalogStore = {
  defaultBitstreamPath: readonly(defaultBitstreamPath),
  staleBitstreamPath: readonly(staleBitstreamPath),
  hasDefaultBitstream: readonly(hasDefaultBitstream),
  hasStaleBitstream: readonly(hasStaleBitstream),
}
