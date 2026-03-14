<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  },
}

const props = defineProps<{
  value: string
  language?: string
}>()

const emit = defineEmits<{
  (e: 'update:value', val: string): void
}>()

const container = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

import { useThemeState } from '@/lib/theme'
import { settingsStore } from '@/stores/settings'

const themeState = useThemeState()

onMounted(() => {
  if (!container.value) return

  // Register Verilog (basic)
  monaco.languages.register({ id: 'verilog' })
  monaco.languages.setMonarchTokensProvider('verilog', {
    keywords: [
      'module',
      'endmodule',
      'input',
      'output',
      'inout',
      'wire',
      'reg',
      'always',
      'begin',
      'end',
      'if',
      'else',
      'case',
      'endcase',
      'default',
      'assign',
      'initial',
      'parameter',
      'localparam',
    ],
    tokenizer: {
      root: [
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
        [/\/\/.*$/, 'comment'],
      ],
    },
  })

  editor = monaco.editor.create(container.value, {
    value: props.value,
    language: props.language || 'verilog',
    theme: themeState.value ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: settingsStore.state.editorMinimap },
    fontSize: settingsStore.state.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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
  () => settingsStore.state.editorFontSize,
  (fontSize) => {
    editor?.updateOptions({ fontSize })
  },
)

watch(
  () => settingsStore.state.editorMinimap,
  (enabled) => {
    editor?.updateOptions({ minimap: { enabled } })
  },
)

onUnmounted(() => {
  editor?.dispose()
})
</script>

<template>
  <div ref="container" class="w-full h-full overflow-hidden border-r border-border"></div>
</template>
