<script setup lang="ts">
import { computed } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useI18n } from '@/lib/i18n'
import { designContextStore } from '@/stores/design-context'
import { projectStore } from '@/stores/project'

defineProps<{
  disabled?: boolean
}>()

const { t } = useI18n()

const selectedSource = designContextStore.selectedSource
const sourceName = designContextStore.sourceName
const moduleNames = designContextStore.moduleNames
const moduleNamesStale = designContextStore.moduleNamesStale
const selectedTopModule = computed(() => designContextStore.primaryModule.value)
const hasTopFile = computed(() => selectedSource.value !== null)
const hasHardwareTopFile = computed(() => selectedSource.value?.isHardwareSource === true)
const hasMultipleModules = computed(() => moduleNames.value.length > 1)

const topModuleDisplay = computed(() => {
  if (!hasHardwareTopFile.value || moduleNames.value.length === 0) {
    return t('topModuleUnavailable')
  }

  return selectedTopModule.value
})

const helperText = computed(() => {
  if (!hasTopFile.value) {
    return t('topModuleNoTopFile')
  }

  if (!hasHardwareTopFile.value) {
    return t('topModuleUnsupportedSource')
  }

  if (moduleNamesStale.value) {
    return t('topModuleStaleHint')
  }

  if (moduleNames.value.length === 0) {
    return t('topModuleNoModules')
  }

  if (moduleNames.value.length === 1) {
    return t('topModuleSingleDetected')
  }

  return t('topModuleChooseHint')
})

function handleTopModuleUpdate(value: unknown) {
  if (typeof value !== 'string') {
    return
  }

  projectStore.setTopModuleName(value)
}
</script>

<template>
  <Card class="border-sidebar-border/70 bg-sidebar-accent/20 shadow-none">
    <CardHeader class="gap-1 px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <CardTitle class="text-[11px] font-semibold uppercase tracking-[0.18em]">
            {{ t('topModuleLabel') }}
          </CardTitle>
          <CardDescription class="truncate text-xs">
            {{
              hasTopFile ? t('topModuleSourceHint', { name: sourceName }) : t('topModuleNoTopFile')
            }}
          </CardDescription>
        </div>
        <Badge variant="outline" class="max-w-[140px] shrink-0 truncate font-mono text-[10px]">
          {{ topModuleDisplay }}
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="space-y-2 px-3 pb-3 pt-0">
      <Select
        v-if="hasMultipleModules"
        :model-value="selectedTopModule"
        @update:model-value="handleTopModuleUpdate"
      >
        <SelectTrigger size="sm" class="w-full min-w-0 bg-background/70" :disabled="disabled">
          <SelectValue :placeholder="t('selectTopModule')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="moduleName in moduleNames" :key="moduleName" :value="moduleName">
            <span class="font-mono text-xs">{{ moduleName }}</span>
          </SelectItem>
        </SelectContent>
      </Select>

      <div v-else class="rounded-md border border-sidebar-border/70 bg-background/60 px-2.5 py-2">
        <p class="truncate font-mono text-xs">{{ topModuleDisplay }}</p>
      </div>

      <p
        class="text-[11px] leading-4"
        :class="moduleNamesStale ? 'text-amber-600' : 'text-muted-foreground'"
      >
        {{ helperText }}
      </p>
    </CardContent>
  </Card>
</template>
