<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CircuitBoard } from 'lucide-vue-next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

const props = defineProps<{
  disabled?: boolean
}>()

const { t } = useI18n()

const selectedSource = designContextStore.selectedSource
const sourceName = designContextStore.sourceName
const hardwareSources = designContextStore.hardwareSources
const moduleSources = designContextStore.moduleSources
const moduleNames = designContextStore.moduleNames
const moduleNamesStale = designContextStore.moduleNamesStale
const selectedTopModule = computed(() => designContextStore.primaryModule.value)
const hasProject = computed(() => projectStore.hasProject)
const hasTopFile = computed(() => selectedSource.value !== null)
const hasHardwareTopFile = computed(() => selectedSource.value?.isHardwareSource === true)
const isDialogOpen = ref(false)
const dialogTopFileId = ref('')
const dialogTopModuleName = ref('')

const detectedModuleSourceCount = computed(() => moduleSources.value.length)
const detectedModuleCount = computed(() => {
  return moduleSources.value.reduce((count, source) => count + source.moduleNames.length, 0)
})

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

const topFileOptions = computed(() => {
  return hardwareSources.value.map((source) => ({
    ...source,
    moduleNames: getModuleNamesForSource(source.id),
  }))
})

const selectedDialogSource = computed(() => {
  if (!dialogTopFileId.value) {
    return topFileOptions.value[0] ?? null
  }

  return topFileOptions.value.find((source) => source.id === dialogTopFileId.value) ?? null
})

const dialogModuleNames = computed(() => {
  return selectedDialogSource.value?.moduleNames ?? []
})

const canOpenTopModuleDialog = computed(() => {
  return !props.disabled && hasProject.value
})

const canApplyDialogSelection = computed(() => {
  return (
    dialogTopFileId.value.trim().length > 0 &&
    dialogTopModuleName.value.trim().length > 0 &&
    dialogModuleNames.value.includes(dialogTopModuleName.value)
  )
})

function getModuleNamesForSource(sourceId: string) {
  if (sourceId === selectedSource.value?.id) {
    return moduleNames.value
  }

  return moduleSources.value.find((source) => source.id === sourceId)?.moduleNames ?? []
}

const triggerLabel = computed(() => {
  if (!hasHardwareTopFile.value || moduleNames.value.length === 0) {
    return t('configureTopModule')
  }

  return selectedTopModule.value
})

function syncDialogState() {
  const defaultSourceId =
    topFileOptions.value.find((source) => source.id === projectStore.topFileId)?.id ??
    topFileOptions.value[0]?.id ??
    ''

  dialogTopFileId.value = defaultSourceId

  const availableModules = getModuleNamesForSource(defaultSourceId)
  const explicitTopModule = projectStore.topModuleName.trim()
  dialogTopModuleName.value =
    explicitTopModule && availableModules.includes(explicitTopModule)
      ? explicitTopModule
      : (availableModules[0] ?? '')
}

function openTopModuleDialog() {
  syncDialogState()
  isDialogOpen.value = true
}

function applyDialogSelection() {
  if (!canApplyDialogSelection.value) {
    return
  }

  projectStore.setTopFile(dialogTopFileId.value)
  projectStore.setTopModuleName(dialogTopModuleName.value)
  isDialogOpen.value = false
}

function resetToAutoDetectedModule() {
  if (dialogTopFileId.value.trim().length === 0) {
    return
  }

  projectStore.setTopFile(dialogTopFileId.value)
  projectStore.setTopModuleName('')
  isDialogOpen.value = false
}

watch(
  () => dialogTopFileId.value,
  (nextSourceId, previousSourceId) => {
    if (!nextSourceId || nextSourceId === previousSourceId) {
      return
    }

    const availableModules = getModuleNamesForSource(nextSourceId)
    if (!availableModules.includes(dialogTopModuleName.value)) {
      dialogTopModuleName.value = availableModules[0] ?? ''
    }
  },
)
</script>

<template>
  <Button
    type="button"
    size="sm"
    variant="outline"
    class="h-7 max-w-[180px] gap-1.5 px-2 text-xs"
    :class="moduleNamesStale ? 'border-amber-500/30 text-amber-700' : ''"
    :disabled="!canOpenTopModuleDialog"
    :title="helperText"
    @click="openTopModuleDialog"
  >
    <CircuitBoard class="h-3.5 w-3.5 shrink-0" />
    <span class="truncate">
      {{ triggerLabel }}
    </span>
  </Button>

  <Dialog :open="isDialogOpen" @update:open="isDialogOpen = $event">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
      <DialogHeader>
        <DialogTitle>{{ t('topModuleDialogTitle') }}</DialogTitle>
        <DialogDescription>
          {{ t('topModuleDialogDescription') }}
        </DialogDescription>
      </DialogHeader>

      <div
        class="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm sm:grid-cols-3"
      >
        <div>
          <p class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {{ t('topModuleTopFileLabel') }}
          </p>
          <p class="truncate font-mono text-xs">
            {{ hasTopFile ? sourceName : t('topModuleUnavailable') }}
          </p>
        </div>
        <div>
          <p class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {{ t('topModuleLabel') }}
          </p>
          <p class="truncate font-mono text-xs">{{ topModuleDisplay }}</p>
        </div>
        <div>
          <p class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {{
              t('topModuleDetectedSummary', {
                files: detectedModuleSourceCount,
                modules: detectedModuleCount,
              })
            }}
          </p>
          <p class="text-xs" :class="moduleNamesStale ? 'text-amber-600' : 'text-muted-foreground'">
            {{ helperText }}
          </p>
        </div>
      </div>

      <div v-if="topFileOptions.length > 0" class="space-y-4">
        <div class="space-y-2">
          <p class="text-sm font-medium">{{ t('topModuleTopFileLabel') }}</p>
          <Select v-model="dialogTopFileId">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('selectTopFile')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="source in topFileOptions" :key="source.id" :value="source.id">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="max-w-[320px] truncate font-mono text-xs">{{ source.path }}</span>
                  <span class="text-[10px] text-muted-foreground">
                    {{ t('topModuleFileModuleCount', { count: source.moduleNames.length }) }}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium">{{ t('topModuleLabel') }}</p>
          <Select v-model="dialogTopModuleName" :disabled="dialogModuleNames.length === 0">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('selectTopModule')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="moduleName in dialogModuleNames"
                :key="moduleName"
                :value="moduleName"
              >
                <span class="font-mono text-xs">{{ moduleName }}</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="dialogModuleNames.length === 0" class="text-xs text-amber-600">
            {{ t('topModuleDialogNoModulesInFile') }}
          </p>
        </div>
      </div>

      <p v-else class="text-sm text-muted-foreground">
        {{ t('topModuleDialogNoHardwareSources') }}
      </p>

      <DialogFooter class="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          :disabled="dialogTopFileId.trim().length === 0"
          @click="resetToAutoDetectedModule"
        >
          {{ t('topModuleUseAuto') }}
        </Button>
        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="isDialogOpen = false">
            {{ t('cancel') }}
          </Button>
          <Button type="button" :disabled="!canApplyDialogSelection" @click="applyDialogSelection">
            {{ t('topModuleApply') }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
