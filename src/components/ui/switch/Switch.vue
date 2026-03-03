<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { PrimitiveProps } from 'reka-ui'
import { computed } from 'vue'
import { Primitive } from 'reka-ui'
import { cn } from '@/lib/utils'

interface Props extends PrimitiveProps {
  checked?: boolean
  disabled?: boolean
  height?: number
  length?: number
  gap?: number
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  checked: false,
  disabled: false,
  height: 20,
  length: 48,
  gap: 2,
})

const emit = defineEmits<{
  (e: 'update:checked', v: boolean): void
}>()

function onToggle() {
  if (props.disabled) return
  emit('update:checked', !props.checked)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onToggle()
  }
}

const current = computed(() => {
  const h = Math.max(14, Math.round(props.height))
  const pad = Math.max(0, Math.round(props.gap))
  const w = Math.max(h + pad * 2 + 12, Math.round(props.length))
  const thumb = h - pad * 2
  return { h, w, pad, thumb }
})

const rootClasses = computed(() =>
  cn(
    'relative inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none',
    'transition-[background-color,border-color] duration-300 ease-in-out',
    'focus-visible:ring-[3px] focus-visible:border-ring focus-visible:ring-ring/50',
    'disabled:cursor-not-allowed disabled:opacity-50',
    props.checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
  ),
)

const rootStyle = computed(() => ({
  height: `${current.value.h}px`,
  width: `${current.value.w}px`,
  padding: `${current.value.pad}px`,
  borderRadius: `${current.value.h / 2}px`,
}))

const thumbClasses = computed(() =>
  cn(
    'pointer-events-none absolute rounded-full ring-0',
    'transition-[left,background-color] duration-300 ease-in-out',
    props.checked ? 'bg-primary-foreground' : 'bg-foreground',
  ),
)

const thumbStyle = computed(() => {
  const pad = current.value.pad
  const size = current.value.thumb
  const left = props.checked ? `${current.value.w - pad - size}px` : `${pad}px`
  return {
    top: `${pad}px`,
    left,
    height: `${size}px`,
    width: `${size}px`,
    borderRadius: `${size / 2}px`,
  }
})
</script>

<template>
  <Primitive
    data-slot="switch"
    :as="as"
    :as-child="asChild"
    role="switch"
    :aria-checked="props.checked"
    :disabled="props.disabled"
    :class="cn(rootClasses, props.class)"
    :style="rootStyle"
    @click="onToggle"
    @keydown="onKeydown"
    tabindex="0"
  >
    <span :class="thumbClasses" :style="thumbStyle" />
  </Primitive>
</template>
