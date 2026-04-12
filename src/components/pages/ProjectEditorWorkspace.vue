<script setup lang="ts">
import { computed } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'

const { t } = useI18n()
const activeFileName = computed(() => projectStore.activeFile?.name || t('noFileSelected'))
const activeFileDirty = computed(() =>
  projectStore.activeFileId ? projectStore.isFileDirty(projectStore.activeFileId) : false,
)
</script>

<template>
  <div class="h-full flex flex-col bg-transparent">
    <div class="app-toolbar-glass h-12 px-4 flex items-center gap-3">
      <div class="min-w-0">
        <p class="text-sm font-medium truncate">
          {{ activeFileName }}<span v-if="activeFileDirty" class="text-amber-600"> *</span>
        </p>
      </div>
      <Badge variant="outline"
        >{{ signalCatalogStore.signals.value.length }} {{ t('portsUnit') }}</Badge
      >
    </div>

    <div class="project-editor-surface flex-1 min-h-0 overflow-hidden">
      <CodeEditor :value="projectStore.code" @update:value="projectStore.updateCode($event)" />
    </div>
  </div>
</template>

<style scoped>
.project-editor-surface {
  background: var(--window-editor-surface);
}
</style>
