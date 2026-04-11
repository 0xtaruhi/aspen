<script setup lang="ts">
import { Check, Copy, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useI18n } from '@/lib/i18n'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    content: string
    emptyText?: string
  }>(),
  {
    description: '',
    emptyText: '',
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const displayContent = computed(() => {
  const content = props.content.trim()
  if (content.length > 0) {
    return content
  }

  return props.emptyText
})

async function copyReportContent() {
  if (displayContent.value.trim().length === 0) {
    return
  }

  try {
    await copyTextToClipboard(displayContent.value)
    copied.value = true
    if (copiedTimer) {
      clearTimeout(copiedTimer)
    }
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1500)
  } catch {
    // Clipboard failures should not interrupt the viewer.
  }
}
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogScrollContent :show-close-button="false" class="h-[85vh] max-h-[85vh] p-0 sm:max-w-4xl">
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
          <DialogHeader class="min-w-0 flex-1 space-y-1">
            <DialogTitle class="break-words text-base">{{ props.title }}</DialogTitle>
            <p
              v-if="props.description"
              class="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
            >
              {{ props.description }}
            </p>
          </DialogHeader>

          <div class="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              :disabled="displayContent.trim().length === 0"
              class="shrink-0 rounded-md"
              @click="copyReportContent"
            >
              <Check v-if="copied" class="mr-2 h-3.5 w-3.5" />
              <Copy v-else class="mr-2 h-3.5 w-3.5" />
              {{ copied ? t('copied') : t('copyLog') }}
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              class="h-8 w-8 shrink-0 rounded-md"
              :aria-label="t('cancel')"
              @click="emit('update:open', false)"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div class="min-h-0 min-w-0 flex-1 overflow-hidden px-4 py-4">
          <pre
            class="allow-text-select h-full min-h-0 min-w-0 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-white px-3 py-3 font-mono text-[12px] leading-5 text-slate-950 dark:bg-black dark:text-white"
            >{{ displayContent }}</pre
          >
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
