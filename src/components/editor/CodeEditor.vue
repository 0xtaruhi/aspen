<script setup lang="ts">
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { normalizeEditorLanguage, type EditorLanguage } from '@/lib/editor-language'
import { ensureMonacoHdlSupport } from '@/lib/monaco-hdl'
import { useThemeState } from '@/lib/theme'
import { settingsStore } from '@/stores/settings'
;(
  globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: () => Worker } }
).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

const props = defineProps<{
  value: string
  language?: EditorLanguage
}>()

const emit = defineEmits<{
  (e: 'update:value', val: string): void
}>()

const container = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

const themeState = useThemeState()

function getEditorLanguage(language?: EditorLanguage): EditorLanguage {
  return normalizeEditorLanguage(language)
}

onMounted(() => {
  if (!container.value) return

  ensureMonacoHdlSupport(monaco)

  const model = monaco.editor.createModel(props.value, getEditorLanguage(props.language))

  editor = monaco.editor.create(container.value, {
    model,
    theme: themeState.value ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: settingsStore.state.editorMinimap },
    fontSize: settingsStore.state.editorFontSize,
    fontFamily: settingsStore.state.editorFontFamily,
    matchBrackets: 'always',
    guides: { bracketPairs: true, indentation: true },
    bracketPairColorization: { enabled: true },
    snippetSuggestions: 'top',
    scrollBeyondLastLine: false,
    padding: { top: 16, bottom: 16 },
  })

  editor.onDidChangeModelContent(() => {
    const val = editor?.getValue() || ''
    emit('update:value', val)
  })
})

watch(
  () => themeState.value,
  (isDark) => {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs')
  },
)

watch(
  () => props.value,
  (val) => {
    if (editor && val !== editor.getValue()) {
      editor.setValue(val)
    }
  },
)

watch(
  () => props.language,
  (language) => {
    const model = editor?.getModel()
    if (!model) {
      return
    }

    monaco.editor.setModelLanguage(model, getEditorLanguage(language))
  },
)

watch(
  () => settingsStore.state.editorFontSize,
  (fontSize) => {
    editor?.updateOptions({ fontSize })
  },
)

watch(
  () => settingsStore.state.editorFontFamily,
  (fontFamily) => {
    editor?.updateOptions({ fontFamily })
    monaco.editor.remeasureFonts()
  },
)

watch(
  () => settingsStore.state.editorMinimap,
  (enabled) => {
    editor?.updateOptions({ minimap: { enabled } })
  },
)

onUnmounted(() => {
  const model = editor?.getModel()
  editor?.dispose()
  model?.dispose()
})
</script>

<template>
  <div
    ref="container"
    class="allow-text-select w-full h-full overflow-hidden border-r border-border"
  ></div>
</template>
