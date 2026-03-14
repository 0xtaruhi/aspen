import { computed } from 'vue'

import { settingsStore } from '@/stores/settings'

const messages = {
  'en-US': {
    application: 'Application',
    settings: 'Settings',
    settingsDescription: 'Configure interface behavior, editor preferences, and safety defaults.',
    appearance: 'Appearance',
    appearanceDescription: 'Visual preferences for the Aspen workspace.',
    language: 'Language',
    languageDescription: 'Switch the preferred UI language for Aspen.',
    editor: 'Editor',
    editorDescription: 'Controls that apply immediately inside the code editor.',
    editorFontSize: 'Editor font size',
    editorMinimap: 'Show minimap',
    safety: 'Safety',
    safetyDescription: 'Guardrails for destructive actions inside the workspace.',
    confirmDelete: 'Ask before delete',
    chinese: 'Simplified Chinese',
    english: 'English',
    themeToggle: 'Toggle theme',
  },
  'zh-CN': {
    application: '应用',
    settings: '设置',
    settingsDescription: '配置界面行为、编辑器偏好和安全默认项。',
    appearance: '界面',
    appearanceDescription: 'Aspen 工作区的视觉与语言偏好。',
    language: '语言',
    languageDescription: '切换 Aspen 的界面语言偏好。',
    editor: '编辑器',
    editorDescription: '这些选项会立刻作用到代码编辑器。',
    editorFontSize: '编辑器字号',
    editorMinimap: '显示缩略图',
    safety: '安全',
    safetyDescription: '控制工作区中破坏性操作的保护行为。',
    confirmDelete: '删除前确认',
    chinese: '简体中文',
    english: '英语',
    themeToggle: '切换主题',
  },
} as const

type MessageKey = keyof (typeof messages)['en-US']

export function useI18n() {
  const language = computed(() => settingsStore.state.language)

  function t(key: MessageKey) {
    return messages[language.value][key] ?? messages['en-US'][key]
  }

  return { language, t }
}
