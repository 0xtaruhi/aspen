<script setup lang="ts">
import { computed } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { Badge } from '@/components/ui/badge'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'

const activeFileName = computed(() => projectStore.activeFile?.name || 'No file selected')
const activeFileDirty = computed(() =>
  projectStore.activeFileId ? projectStore.isFileDirty(projectStore.activeFileId) : false,
)
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <div class="h-12 border-b border-border bg-muted/20 px-4 flex items-center gap-3">
      <div class="min-w-0">
        <p class="text-sm font-medium truncate">
          {{ activeFileName }}<span v-if="activeFileDirty" class="text-amber-600"> *</span>
        </p>
      </div>
      <Badge variant="outline">{{ signalCatalogStore.signals.value.length }} ports</Badge>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden bg-card">
      <CodeEditor :value="projectStore.code" @update:value="projectStore.updateCode($event)" />
    </div>
  </div>
</template>
