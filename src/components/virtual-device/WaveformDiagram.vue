<script setup lang="ts">
import { computed, ref } from 'vue'
import stringify from '@onml-stringify'
import renderAny from '@wavedrom-render-any'
import waveSkin from '@wavedrom-skin-default'

import { Dialog, DialogContent } from '@/components/ui/dialog'

const props = defineProps<{
  id: string
  index: number
  title: string
  description: string
  source: Record<string, unknown>
}>()

const WAVEFORM_PADDING_X = 12
const WAVEFORM_PADDING_Y = 10
const isViewerOpen = ref(false)

type WaveDromNode = [
  tag: string,
  attrs?: Record<string, string | number | undefined>,
  ...children: unknown[],
]

function parseNumericAttribute(value: string | number | undefined, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function renderSvgMarkup(renderIndex: number) {
  const rendered = renderAny(renderIndex, props.source, waveSkin) as WaveDromNode
  const attrs = (rendered[1] ??= {})
  const width = parseNumericAttribute(attrs.width, 0)
  const height = parseNumericAttribute(attrs.height, 0)

  attrs.width = width + WAVEFORM_PADDING_X * 2
  attrs.height = height + WAVEFORM_PADDING_Y * 2
  attrs.viewBox = `${-WAVEFORM_PADDING_X} ${-WAVEFORM_PADDING_Y} ${width + WAVEFORM_PADDING_X * 2} ${height + WAVEFORM_PADDING_Y * 2}`
  attrs.overflow = 'visible'
  attrs.style = 'display:block;max-width:none;height:auto'

  return stringify(rendered)
}

const inlineSvgMarkup = computed(() => renderSvgMarkup(props.index * 2))
const dialogSvgMarkup = computed(() => renderSvgMarkup(props.index * 2 + 1))
</script>

<template>
  <section class="rounded-xl border border-border/70 bg-background/70 p-4">
    <div class="min-w-0 space-y-1">
      <h4 class="text-sm font-semibold">{{ title }}</h4>
      <p v-if="description" class="text-xs leading-5 text-muted-foreground">
        {{ description }}
      </p>
    </div>

    <div
      class="mt-4 cursor-zoom-in overflow-x-auto overflow-y-hidden rounded-lg border border-border/60 bg-card p-3"
      role="button"
      tabindex="0"
      @click="isViewerOpen = true"
      @keydown.enter.prevent="isViewerOpen = true"
      @keydown.space.prevent="isViewerOpen = true"
    >
      <div
        :id="`waveform-${id}`"
        class="waveform-root min-w-max text-foreground"
        v-html="inlineSvgMarkup"
      />
    </div>

    <Dialog :open="isViewerOpen" @update:open="isViewerOpen = $event">
      <DialogContent
        :show-close-button="false"
        class="!w-auto !max-w-[96vw] gap-0 border-0 bg-transparent p-0 shadow-none"
      >
        <div class="max-h-[92vh] max-w-[96vw] overflow-auto rounded-xl bg-card p-4">
          <div
            :id="`waveform-dialog-${id}`"
            class="waveform-root min-w-max text-foreground"
            v-html="dialogSvgMarkup"
          />
        </div>
      </DialogContent>
    </Dialog>
  </section>
</template>

<style scoped>
.waveform-root :deep(svg.WaveDrom) {
  display: block;
  max-width: none;
}
</style>
