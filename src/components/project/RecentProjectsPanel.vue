<script setup lang="ts">
import { computed } from 'vue'
import { FolderOpen, History } from 'lucide-vue-next'

import { useI18n } from '@/lib/i18n'
import { openRecentProject } from '@/lib/project-io'
import { recentProjectsStore } from '@/stores/recent-projects'

const { t } = useI18n()
const recentProjects = computed(() => recentProjectsStore.state.entries)

function handleOpenRecentProject(path: string) {
  void openRecentProject(path)
}
</script>

<template>
  <section class="rounded-xl border border-border/70 bg-muted/20 p-3">
    <div class="mb-3 flex items-center gap-2">
      <div
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/70"
      >
        <History class="h-4 w-4" />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ t('recentProjects') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('openRecent') }}</p>
      </div>
    </div>

    <p v-if="recentProjects.length === 0" class="text-sm text-muted-foreground">
      {{ t('noRecentProjects') }}
    </p>

    <div v-else class="space-y-2">
      <button
        v-for="entry in recentProjects"
        :key="entry.path"
        type="button"
        class="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
        :title="entry.path"
        @click="handleOpenRecentProject(entry.path)"
      >
        <div
          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <FolderOpen class="h-3.5 w-3.5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ entry.name }}</p>
          <p class="truncate text-xs text-muted-foreground">{{ entry.path }}</p>
        </div>
      </button>
    </div>
  </section>
</template>
