<script setup lang="ts">
import { computed, markRaw, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as monaco from 'monaco-editor/editor/editor.api'

import CodeEditor from '@/components/editor/CodeEditor.vue'
import { Badge } from '@/components/ui/badge'
import { buildEditorFileUri, resolveEditorLanguage } from '@/lib/editor-language'
import {
  buildHdlProjectSessionId,
  ensureHdlLspSession,
  ensureHdlTextModel,
  hdlLspStatus,
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
const lspRootUri = ref('')
let syncVersion = 0

const lspStatusMessageKeys = {
  idle: 'lspStatusIdle',
  starting: 'lspStatusStarting',
  ready: 'lspStatusReady',
  unavailable: 'lspStatusUnavailable',
  error: 'lspStatusError',
} as const
const lspStatusLabel = computed(() => t(lspStatusMessageKeys[hdlLspStatus.value.state]))
const lspStatusDotClass = computed(
  () =>
    ({
      idle: 'bg-muted-foreground/50',
      starting: 'bg-amber-500 animate-pulse',
      ready: 'bg-emerald-500',
      unavailable: 'bg-rose-500',
      error: 'bg-rose-500',
    })[hdlLspStatus.value.state],
)

function updateProjectFile(path: string, content: string) {
  const entry = projectFileEntries.value.find((candidate) => candidate.path === path)
  if (entry && entry.node.content !== content) projectStore.updateFileCode(entry.node.id, content)
}

function handleModelChange(uri: string) {
  if (!lspRootUri.value) return
  const entry = projectFileEntries.value.find(
    (candidate) => buildEditorFileUri(lspRootUri.value, candidate.path) === uri,
  )
  if (entry && entry.node.id !== projectStore.activeFileId)
    projectStore.setActiveFile(entry.node.id)
}

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
      onFileChange: updateProjectFile,
    }).catch((error) => {
      console.error('[HDL LSP] Failed to initialize session:', error)
      return null
    })

    if (currentVersion !== syncVersion || !response?.root_uri) {
      return
    }

    lspRootUri.value = response.root_uri

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
    void stopHdlLspSession(previousSessionId).catch((error) => {
      console.error('[HDL LSP] Failed to stop previous session:', error)
    })
  },
)

onUnmounted(() => {
  syncVersion += 1
  const sessionId = buildHdlProjectSessionId(projectStore.projectPath, projectStore.sessionId)
  void stopHdlLspSession(sessionId).catch((error) => {
    console.error('[HDL LSP] Failed to stop session:', error)
  })
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
      <Badge
        variant="outline"
        class="ml-auto gap-1.5 font-normal text-muted-foreground"
        :title="hdlLspStatus.detail || lspStatusLabel"
        aria-live="polite"
      >
        <span class="size-1.5 rounded-full" :class="lspStatusDotClass" />
        {{ lspStatusLabel }}
      </Badge>
    </div>

    <div class="project-editor-surface flex-1 min-h-0 overflow-hidden">
      <CodeEditor
        :value="projectStore.code"
        :language="activeEditorLanguage"
        :model="activeModel"
        @change:model="handleModelChange"
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
