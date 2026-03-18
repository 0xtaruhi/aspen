import { computed } from 'vue'

import enUsMessages from '@/lib/locales/en-US.json'
import zhCnMessages from '@/lib/locales/zh-CN.json'
import zhTwMessages from '@/lib/locales/zh-TW.json'
import { settingsStore } from '@/stores/settings'

const messages = {
  'en-US': enUsMessages,
  'zh-CN': zhCnMessages,
  'zh-TW': zhTwMessages,
} as const

type MessageKey = keyof typeof enUsMessages

type MessageParams = Record<string, string | number>

function formatMessage(template: string, params?: MessageParams) {
  if (!params) {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

export function translate(key: MessageKey, params?: MessageParams) {
  const template = messages[settingsStore.state.language][key] ?? messages['en-US'][key]
  return formatMessage(template, params)
}

export function useI18n() {
  const language = computed(() => settingsStore.state.language)

  function t(key: MessageKey, params?: MessageParams) {
    const template = messages[language.value][key] ?? messages['en-US'][key]
    return formatMessage(template, params)
  }

  return { language, t }
}
