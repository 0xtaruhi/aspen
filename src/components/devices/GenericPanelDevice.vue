<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@/lib/i18n'

type GenericPanelVariant =
  | 'keypad'
  | 'small_keypad'
  | 'rotary_button'
  | 'ps2_keyboard'
  | 'text_lcd'
  | 'graphic_lcd'

const props = defineProps<{
  title: string
  isOn?: boolean
  interactive?: boolean
  variant?: GenericPanelVariant
}>()

const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
}>()
const { t } = useI18n()

const variant = computed<GenericPanelVariant>(() => props.variant ?? 'keypad')

const shellClass = computed(() => {
  switch (variant.value) {
    case 'text_lcd':
      return 'min-w-[250px] rounded-xl border border-emerald-700/50 bg-[linear-gradient(180deg,rgba(17,24,39,0.96),rgba(10,15,24,0.98))] p-3'
    case 'graphic_lcd':
      return 'min-w-[270px] rounded-xl border border-sky-900/60 bg-[linear-gradient(180deg,rgba(8,14,24,0.98),rgba(6,10,18,0.98))] p-3'
    case 'ps2_keyboard':
      return 'min-w-[228px] rounded-xl border border-zinc-700 bg-[linear-gradient(180deg,rgba(28,28,33,0.98),rgba(16,16,20,0.98))] p-3'
    case 'rotary_button':
      return 'min-w-[140px] rounded-xl border border-amber-900/50 bg-[linear-gradient(180deg,rgba(30,24,18,0.98),rgba(18,13,10,0.98))] p-3'
    case 'small_keypad':
      return 'min-w-[150px] rounded-xl border border-zinc-700 bg-[linear-gradient(180deg,rgba(31,31,36,0.98),rgba(19,19,24,0.98))] p-3'
    case 'keypad':
    default:
      return 'min-w-[196px] rounded-xl border border-zinc-700 bg-[linear-gradient(180deg,rgba(31,31,36,0.98),rgba(19,19,24,0.98))] p-3'
  }
})

const screenGlowClass = computed(() => {
  return props.isOn
    ? 'shadow-[0_0_28px_rgba(52,211,153,0.18)]'
    : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
})

const keypadKeys = computed(() => {
  if (variant.value === 'small_keypad') {
    return ['1', '2', '3', '4', '5', '6']
  }

  if (variant.value === 'ps2_keyboard') {
    return ['Esc', 'F1', 'F2', 'F3', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F']
  }

  return ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']
})

const keypadColumns = computed(() => {
  switch (variant.value) {
    case 'small_keypad':
      return 'repeat(3, minmax(0, 1fr))'
    case 'ps2_keyboard':
      return 'repeat(4, minmax(0, 1fr))'
    default:
      return 'repeat(4, minmax(0, 1fr))'
  }
})

const lcdCharacters = computed(() => {
  if (!props.isOn) {
    return ['                ', '                ']
  }

  return ['ASPEN READY     ', 'SIGNAL LINK OK  ']
})

const graphicRows = computed(() => {
  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 12 }, (_, col) => ((row + col + (props.isOn ? 1 : 0)) % 3 === 0 ? 1 : 0)),
  )
})

function toggle() {
  if (!props.interactive) {
    return
  }

  emit('toggle', !props.isOn)
}
</script>

<template>
  <button
    type="button"
    class="text-left transition-transform duration-150"
    :class="interactive ? 'cursor-pointer active:scale-[0.99]' : 'cursor-default'"
    @click="toggle"
  >
    <div :class="shellClass">
      <div class="mb-3 flex items-start gap-3">
        <div
          class="mt-1 h-2.5 w-2.5 rounded-full transition-colors"
          :class="isOn ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'"
        ></div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-200">
            {{ title }}
          </div>
          <div class="mt-1 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            {{ isOn ? t('high') : t('low') }}
          </div>
        </div>
      </div>

      <div
        v-if="variant === 'text_lcd'"
        class="rounded-lg border border-emerald-500/25 bg-[linear-gradient(180deg,rgba(6,43,32,0.96),rgba(4,28,21,0.98))] p-4"
        :class="screenGlowClass"
      >
        <div
          class="rounded-md border border-emerald-300/12 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.16),rgba(16,185,129,0.05),transparent_70%)] px-4 py-3 font-mono text-[13px] leading-6 tracking-[0.24em]"
          :class="isOn ? 'text-emerald-200' : 'text-emerald-950/60'"
        >
          <div v-for="(line, index) in lcdCharacters" :key="index">{{ line }}</div>
        </div>
      </div>

      <div
        v-else-if="variant === 'graphic_lcd'"
        class="rounded-lg border border-sky-400/15 bg-[linear-gradient(180deg,rgba(7,23,41,0.96),rgba(5,14,25,0.98))] p-4"
      >
        <div
          class="grid rounded-md border border-sky-300/10 bg-black/40 p-3"
          :class="screenGlowClass"
          style="grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px"
        >
          <div
            v-for="(cell, index) in graphicRows.flat()"
            :key="index"
            class="h-3.5 w-3.5 rounded-[3px] border border-sky-950/70"
            :class="
              cell && isOn
                ? 'bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.5)]'
                : 'bg-slate-900/90'
            "
          ></div>
        </div>
      </div>

      <div
        v-else-if="variant === 'rotary_button'"
        class="flex items-center justify-center rounded-lg border border-amber-500/15 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.08),rgba(24,24,27,0.96))] p-4"
      >
        <div
          class="relative h-20 w-20 rounded-full border border-zinc-600 bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.2),rgba(82,82,91,0.08),rgba(24,24,27,0.98)_72%)] shadow-[inset_0_-10px_24px_rgba(0,0,0,0.4),0_10px_28px_rgba(0,0,0,0.22)]"
        >
          <div
            class="absolute left-1/2 top-3 h-6 w-1.5 -translate-x-1/2 rounded-full"
            :class="isOn ? 'bg-amber-300' : 'bg-zinc-600'"
          ></div>
          <div
            class="absolute inset-2 rounded-full border"
            :class="isOn ? 'border-amber-300/40' : 'border-zinc-700'"
          ></div>
        </div>
      </div>

      <div
        v-else
        class="rounded-lg border border-zinc-700/90 bg-[linear-gradient(180deg,rgba(17,24,39,0.18),rgba(10,10,14,0.55))] p-3"
      >
        <div
          class="grid"
          :style="{
            gridTemplateColumns: keypadColumns,
            gap: variant === 'ps2_keyboard' ? '8px' : '10px',
          }"
        >
          <div
            v-for="key in keypadKeys"
            :key="key"
            class="grid place-items-center rounded-lg border text-[11px] font-semibold tracking-wide transition-colors"
            :class="
              variant === 'ps2_keyboard'
                ? [
                    'h-8 border-zinc-600/70 bg-zinc-800/85 text-zinc-200',
                    interactive && isOn ? 'border-sky-400/70 bg-sky-500/10 text-sky-100' : '',
                  ]
                : [
                    'h-10 border-zinc-600/70 bg-zinc-800/90 text-zinc-200',
                    interactive && isOn
                      ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-100'
                      : '',
                  ]
            "
          >
            {{ key }}
          </div>
        </div>
      </div>

      <div v-if="interactive" class="mt-3 text-[9px] uppercase tracking-[0.22em] text-zinc-500">
        {{ t('clickToDrive', { state: isOn ? t('low') : t('high') }) }}
      </div>
    </div>
  </button>
</template>
