<script setup lang="ts">
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { computed, markRaw, onUnmounted, shallowRef, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { Badge } from '@/components/ui/badge'
import { resolveEditorLanguage } from '@/lib/editor-language'
import {
  buildHdlProjectSessionId,
  ensureHdlLspSession,
  ensureHdlTextModel,
  stopHdlLspSession,
} from '@/lib/hdl-lsp'
import { useI18n } from '@/lib/i18n'
import { projectStore } from '@/stores/project'
import {
  collectProjectFileEntries,
  type ProjectSourceFileSnapshot,
} from '@/stores/project-tree-files'
import { signalCatalogStore } from '@/stores/signal-catalog'

const { t } = useI18n()
const activeFileName = computed(() => projectStore.activeFile?.name || t('noFileSelected'))
const activeFileDirty = computed(() =>
  projectStore.activeFileId ? projectStore.isFileDirty(projectStore.activeFileId) : false,
)
const activeEditorLanguage = computed(() => resolveEditorLanguage(projectStore.activeFile?.name))
const projectFileEntries = computed(() => collectProjectFileEntries(projectStore.files))
const activeFilePath = computed(
  () =>
    projectFileEntries.value.find((entry) => entry.node.id === projectStore.activeFileId)?.path ??
    '',
)
const projectSources = computed<ProjectSourceFileSnapshot[]>(() =>
  projectFileEntries.value.map((entry) => ({
    path: entry.path,
    content: entry.node.content ?? '',
  })),
)
const projectFilesKey = computed(() => projectSources.value.map((entry) => entry.path).join('\n'))

const activeModel = shallowRef<monaco.editor.ITextModel | null>(null)
let syncVersion = 0

watch(
  [
    () => projectStore.sessionId,
    () => projectStore.activeFileId,
    () => projectStore.activeFile?.content ?? '',
    () => projectStore.activeFile?.name ?? '',
  ],
  async () => {
    const language = activeEditorLanguage.value
    const filePath = activeFilePath.value
    const file = projectStore.activeFile

    syncVersion += 1
    const currentVersion = syncVersion

    if (!file || file.type !== 'file' || !filePath || language === 'plaintext') {
      activeModel.value = null
      return
    }

    const sessionId = buildHdlProjectSessionId(projectStore.projectPath, projectStore.sessionId)
    const response = await ensureHdlLspSession({
      sessionId,
      rootUri: null,
      filesKey: projectFilesKey.value,
      files: projectSources.value,
    }).catch(() => null)

    if (currentVersion !== syncVersion || !response?.root_uri) {
      return
    }

    activeModel.value = markRaw(
      ensureHdlTextModel(
        {
          path: filePath,
          content: file.content ?? '',
          language,
        },
        {
          rootUri: response.root_uri,
        },
      ),
    )
  },
  {
    immediate: true,
  },
)

watch(
  () => projectStore.sessionId,
  (next, previous) => {
    if (previous === undefined || previous === next) {
      return
    }

    const previousSessionId = buildHdlProjectSessionId(projectStore.projectPath, previous)
    void stopHdlLspSession(previousSessionId)
  },
)

onUnmounted(() => {
  const sessionId = buildHdlProjectSessionId(projectStore.projectPath, projectStore.sessionId)
  void stopHdlLspSession(sessionId)
})
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
      <CodeEditor
        :value="projectStore.code"
        :language="activeEditorLanguage"
        :model="activeModel"
        @update:value="projectStore.updateCode($event)"
      />
    </div>
  </div>
</template>

<style scoped>
.project-editor-surface {
  background: var(--window-editor-surface);
}
</style>
