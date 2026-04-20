<script setup lang="ts">
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

import { computed, onUnmounted, ref, watch } from 'vue'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { Badge } from '@/components/ui/badge'
import { resolveEditorLanguage } from '@/lib/editor-language'
import {
  buildHdlProjectSessionId,
  ensureHdlLspSession,
  ensureHdlTextModel,
  getActiveHdlLspRootUri,
  getHdlLspStatus,
  resolveHdlWorkspaceRootUri,
  stopHdlLspSession,
} from '@/lib/hdl-lsp'
import { useI18n } from '@/lib/i18n'
import { findProjectNodePathById } from '@/lib/project-tree-path'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'
import { collectProjectSourceFiles } from '@/stores/project-tree-files'

const { t } = useI18n()
const activeFileName = computed(() => projectStore.activeFile?.name || t('noFileSelected'))
const activeFileDirty = computed(() =>
  projectStore.activeFileId ? projectStore.isFileDirty(projectStore.activeFileId) : false,
)
const activeEditorLanguage = computed(() => resolveEditorLanguage(projectStore.activeFile?.name))
const activeModel = ref<monaco.editor.ITextModel | null>(null)
const activeSessionId = computed(() =>
  buildHdlProjectSessionId(projectStore.projectPath, projectStore.sessionId),
)
const activeFilePath = computed(() => {
  if (!projectStore.activeFileId) {
    return ''
  }

  return findProjectNodePathById(projectStore.files, projectStore.activeFileId)
})

async function syncActiveModel() {
  const activeFile = projectStore.activeFile
  if (!activeFile || activeFile.type !== 'file') {
    activeModel.value = null
    return
  }

  const language = activeEditorLanguage.value
  if (language === 'plaintext') {
    activeModel.value = null
    return
  }

  const files = collectProjectSourceFiles(projectStore.files)
  const currentPath = activeFilePath.value
  const matchingFile = files.find((file) => file.path === currentPath)
  if (!matchingFile) {
    activeModel.value = null
    return
  }

  const lspStatus = await getHdlLspStatus().catch(() => null)
  if (!lspStatus?.available) {
    activeModel.value = null
    return
  }

  const session = await ensureHdlLspSession({
    sessionId: activeSessionId.value,
    rootUri: resolveHdlWorkspaceRootUri(projectStore.projectPath),
    files,
  }).catch(() => null)

  const rootUri = session?.root_uri ?? getActiveHdlLspRootUri()
  if (!rootUri) {
    activeModel.value = null
    return
  }

  activeModel.value = ensureHdlTextModel(
    {
      path: matchingFile.path,
      content: matchingFile.content,
      language,
    },
    { rootUri },
  )
}

watch(
  [
    () => projectStore.sessionId,
    () => projectStore.projectPath,
    () => projectStore.activeFileId,
    () => projectStore.code,
    activeEditorLanguage,
    activeFilePath,
  ],
  () => {
    void syncActiveModel()
  },
  { immediate: true },
)

onUnmounted(() => {
  activeModel.value = null
  void stopHdlLspSession(activeSessionId.value)
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
