<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  textLog: string
}>()

const emit = defineEmits<{
  (e: 'queue-text', value: string): void
}>()

const inputValue = ref('')
const { t } = useI18n()

function submit() {
  if (!inputValue.value) {
    return
  }
  emit('queue-text', inputValue.value)
  inputValue.value = ''
}
</script>

<template>
  <div class="flex h-full w-full flex-col gap-2 p-2.5">
    <div
      class="rounded-md border border-border/70 bg-muted/25 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
    >
      {{ t('serialConsole') }}
    </div>
    <div class="min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-[#0a0a0a]">
      <pre
        class="h-full overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100"
        >{{ props.textLog || t('uartTerminalIdle') }}</pre
      >
    </div>
    <div class="flex gap-2">
      <input
        v-model="inputValue"
        class="flex-1 rounded-md border border-border/80 bg-background px-3 py-2 font-mono text-sm"
        :placeholder="t('uartTerminalInputPlaceholder')"
        @keydown.enter.prevent="submit"
      />
      <button
        type="button"
        class="rounded-md border border-border/80 bg-muted px-3 py-2 text-sm font-medium transition hover:bg-accent"
        @click.stop="submit"
      >
        {{ t('send') }}
      </button>
    </div>
  </div>
</template>
