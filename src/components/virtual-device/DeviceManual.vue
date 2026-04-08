<script setup lang="ts">
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import WaveformDiagram from '@/components/virtual-device/WaveformDiagram.vue'
import { resolveCanvasDeviceManual } from '@/components/virtual-device/manuals/registry'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  device: CanvasDeviceSnapshot
}>()

const { language, t } = useI18n()

const manual = computed(() =>
  resolveCanvasDeviceManual(
    props.device,
    (language.value === 'zh-TW' ? 'zh-TW' : language.value) as 'en-US' | 'zh-CN' | 'zh-TW',
  ),
)

const markdownHtml = computed(() => {
  const markdown = manual.value.markdown.trim()
  if (!markdown) {
    return ''
  }

  return DOMPurify.sanitize(String(marked.parse(markdown)))
})

function directionLabel(direction: 'fpga_to_device' | 'device_to_fpga' | 'bidirectional') {
  if (direction === 'fpga_to_device') {
    return t('manualDirectionFpgaToDevice')
  }

  if (direction === 'device_to_fpga') {
    return t('manualDirectionDeviceToFpga')
  }

  return t('manualDirectionBidirectional')
}

function directionVariant(direction: 'fpga_to_device' | 'device_to_fpga' | 'bidirectional') {
  if (direction === 'fpga_to_device') {
    return 'secondary'
  }

  if (direction === 'device_to_fpga') {
    return 'default'
  }

  return 'outline'
}
</script>

<template>
  <div class="space-y-5">
    <section class="device-manual-card rounded-xl border border-border/70 bg-background/70 p-4">
      <p class="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {{ t('manualSummaryShared') }}
      </p>
      <p class="mt-2 text-sm leading-6 text-foreground/90">
        {{ manual.summary }}
      </p>
    </section>

    <section
      v-if="markdownHtml"
      class="device-manual-card rounded-xl border border-border/70 bg-background/70 p-4"
    >
      <div class="mb-3 flex items-center gap-2">
        <h3 class="text-sm font-semibold">{{ t('manualOverview') }}</h3>
      </div>
      <div
        class="device-manual-markdown text-sm leading-6 text-foreground/90"
        v-html="markdownHtml"
      />
    </section>

    <section class="device-manual-card rounded-xl border border-border/70 bg-background/70 p-4">
      <div class="mb-3 flex items-center gap-2">
        <h3 class="text-sm font-semibold">{{ t('manualPins') }}</h3>
      </div>
      <Table class="device-manual-table">
        <TableHeader>
          <TableRow>
            <TableHead class="w-24">{{ t('manualPinName') }}</TableHead>
            <TableHead class="w-36">{{ t('manualPinDirection') }}</TableHead>
            <TableHead>{{ t('manualPinDescription') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="pinInfo in manual.pins" :key="pinInfo.name">
            <TableCell class="font-mono text-xs">{{ pinInfo.name }}</TableCell>
            <TableCell>
              <Badge :variant="directionVariant(pinInfo.direction)">
                {{ directionLabel(pinInfo.direction) }}
              </Badge>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ pinInfo.description }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <section class="device-manual-card rounded-xl border border-border/70 bg-background/70 p-4">
      <div class="mb-3 flex items-center gap-2">
        <h3 class="text-sm font-semibold">{{ t('manualParameters') }}</h3>
      </div>
      <div
        v-if="manual.parameters.length === 0"
        class="rounded-lg border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground"
      >
        {{ t('manualNoParameters') }}
      </div>
      <Table v-else class="device-manual-table">
        <TableHeader>
          <TableRow>
            <TableHead class="w-32">{{ t('manualParameterName') }}</TableHead>
            <TableHead class="w-28">{{ t('manualParameterValue') }}</TableHead>
            <TableHead class="w-28">{{ t('manualParameterDefault') }}</TableHead>
            <TableHead>{{ t('manualParameterDescription') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="parameter in manual.parameters" :key="parameter.name">
            <TableCell class="font-medium">{{ parameter.name }}</TableCell>
            <TableCell class="font-mono text-xs">{{ parameter.value }}</TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">
              {{ parameter.defaultValue ?? '—' }}
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">
              {{ parameter.description }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold">{{ t('manualWaveforms') }}</h3>
      </div>
      <div
        v-if="manual.waveforms.length === 0"
        class="rounded-xl border border-dashed border-border/70 bg-background/70 px-4 py-5 text-sm text-muted-foreground"
      >
        {{ t('manualNoWaveforms') }}
      </div>
      <WaveformDiagram
        v-for="(waveform, index) in manual.waveforms"
        :id="waveform.id"
        :key="waveform.id"
        :index="index"
        :title="waveform.title"
        :description="waveform.description"
        :source="waveform.source"
      />
    </section>
  </div>
</template>

<style scoped>
.device-manual-card {
  min-width: 0;
  overflow: hidden;
}

.device-manual-table :deep(table) {
  table-layout: fixed;
}

.device-manual-table :deep([data-slot='table-head']),
.device-manual-table :deep([data-slot='table-cell']) {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  vertical-align: top;
}

.device-manual-markdown :deep(p) {
  margin: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.device-manual-markdown :deep(p + p) {
  margin-top: 0.85rem;
}

.device-manual-markdown :deep(ul) {
  margin: 0.85rem 0 0;
  padding-left: 1rem;
}

.device-manual-markdown :deep(li + li) {
  margin-top: 0.45rem;
}

.device-manual-markdown :deep(li),
.device-manual-markdown :deep(strong),
.device-manual-markdown :deep(em),
.device-manual-markdown :deep(code) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.device-manual-markdown :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}
</style>
