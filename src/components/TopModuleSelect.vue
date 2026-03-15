<script setup lang="ts">
import { computed } from 'vue'

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

const moduleNames = designContextStore.moduleNames
const selectedTopModule = computed(() => designContextStore.primaryModule.value)

function handleTopModuleUpdate(value: unknown) {
  if (typeof value !== 'string') {
    return
  }

  projectStore.setTopModuleName(value)
}
</script>

<template>
  <div v-if="moduleNames.length > 0" class="flex items-center gap-2">
    <span class="text-xs text-muted-foreground">{{ t('topModuleLabel') }}</span>
    <Select :model-value="selectedTopModule" @update:model-value="handleTopModuleUpdate">
      <SelectTrigger size="sm" class="min-w-[180px]" :disabled="disabled">
        <SelectValue :placeholder="t('selectTopModule')" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="moduleName in moduleNames" :key="moduleName" :value="moduleName">
          <span class="font-mono text-xs">{{ moduleName }}</span>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
