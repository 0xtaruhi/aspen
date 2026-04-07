<script setup lang="ts">
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { computed, ref, watch } from 'vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CANVAS_MEMORY_MAX_ADDRESS_WIDTH,
  CANVAS_MEMORY_PREVIEW_WORDS,
  getCanvasMemoryConfig,
  getCanvasMemoryData,
  getCanvasMemoryWordsData,
} from '@/lib/canvas-devices'
import { loadHardwareMemoryImage } from '@/lib/hardware-client'
import type { CanvasDeviceSnapshot, CanvasMemoryMode } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import {
  basenameFromPath,
  clampInspectorInt,
  formatMemoryAddress,
  formatMemoryWord,
  memorySlotCount,
  memoryWordCount,
  requiredMemoryAddressWidth,
  resizeCanvasSlotBindings,
} from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

const { t } = useI18n()
const config = computed(() => getCanvasMemoryConfig(props.device))
const data = computed(() => getCanvasMemoryData(props.device))
const addressWidthInput = ref('8')
const dataWidthInput = ref('8')
const previewOffsetInput = ref('0')

watch(
  () => ({
    addressWidth: config.value?.addressWidth ?? 8,
    dataWidth: config.value?.dataWidth ?? 8,
    previewOffset: data.value.previewOffset,
  }),
  (value) => {
    addressWidthInput.value = String(value.addressWidth)
    dataWidthInput.value = String(value.dataWidth)
    previewOffsetInput.value = String(value.previewOffset)
  },
  { immediate: true },
)

const memoryPreviewRows = computed(() => {
  const wordCount = memoryWordCount(config.value?.addressWidth ?? 8)
  const previewOffset = clampInspectorInt(
    previewOffsetInput.value,
    data.value.previewOffset,
    0,
    Math.max(0, wordCount - 1),
  )
  const telemetry = hardwareStore.deviceTelemetry.value[props.device.id]
  const liveWords =
    hardwareStore.dataStreamStatus.value.running &&
    telemetry?.sample_values?.length &&
    telemetry.memory_preview_start === previewOffset
      ? telemetry.sample_values
      : null
  const sourceWords =
    liveWords ?? data.value.words.slice(previewOffset, previewOffset + CANVAS_MEMORY_PREVIEW_WORDS)

  return sourceWords.map((value, localIndex) => ({
    index: previewOffset + localIndex,
    value,
  }))
})

const memorySourceLabel = computed(() => basenameFromPath(data.value.sourcePath))

function upsert(device: CanvasDeviceSnapshot) {
  void hardwareStore.upsertCanvasDevice(device)
}

function commitMemoryGeometry() {
  const addressWidth = clampInspectorInt(
    addressWidthInput.value,
    config.value?.addressWidth ?? 8,
    1,
    CANVAS_MEMORY_MAX_ADDRESS_WIDTH,
  )
  const dataWidth = clampInspectorInt(dataWidthInput.value, config.value?.dataWidth ?? 8, 1, 16)
  const wordCount = memoryWordCount(addressWidth)
  const previousWords = getCanvasMemoryWordsData(props.device, wordCount)
  const words = Array.from({ length: wordCount }, (_, index) => previousWords[index] ?? 0)
  const previewOffset = clampInspectorInt(
    previewOffsetInput.value,
    data.value.previewOffset,
    0,
    Math.max(0, wordCount - 1),
  )

  addressWidthInput.value = String(addressWidth)
  dataWidthInput.value = String(dataWidth)
  previewOffsetInput.value = String(previewOffset)

  upsert({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(
        props.device,
        memorySlotCount(config.value?.mode ?? 'ram', addressWidth, dataWidth),
      ),
      config: {
        kind: 'memory',
        mode: config.value?.mode ?? 'ram',
        address_width: addressWidth,
        data_width: dataWidth,
      },
      data: {
        kind: 'memory',
        words,
        source_path: data.value.sourcePath,
        preview_offset: previewOffset,
      },
    },
  })
}

function commitMemoryMode(value: string) {
  if (value !== 'rom' && value !== 'ram') {
    return
  }

  upsert({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(
        props.device,
        memorySlotCount(
          value as CanvasMemoryMode,
          config.value?.addressWidth ?? 8,
          config.value?.dataWidth ?? 8,
        ),
      ),
      config: {
        kind: 'memory',
        mode: value as CanvasMemoryMode,
        address_width: config.value?.addressWidth ?? 8,
        data_width: config.value?.dataWidth ?? 8,
      },
    },
  })
}

function commitMemoryPreviewOffset() {
  const wordCount = memoryWordCount(config.value?.addressWidth ?? 8)
  const previewOffset = clampInspectorInt(
    previewOffsetInput.value,
    data.value.previewOffset,
    0,
    Math.max(0, wordCount - 1),
  )
  previewOffsetInput.value = String(previewOffset)

  upsert({
    ...props.device,
    state: {
      ...props.device.state,
      data: {
        kind: 'memory',
        words: data.value.words,
        source_path: data.value.sourcePath,
        preview_offset: previewOffset,
      },
    },
  })
}

function commitMemoryPreviewWord(index: number, value: string) {
  const parsed = Number.parseInt(value, 16)
  if (Number.isNaN(parsed)) {
    return
  }

  const dataWidth = config.value?.dataWidth ?? 8
  const dataMask = dataWidth >= 16 ? 0xffff : (1 << dataWidth) - 1
  const words = [...data.value.words]
  if (index < 0 || index >= words.length) {
    return
  }
  words[index] = parsed & dataMask

  upsert({
    ...props.device,
    state: {
      ...props.device.state,
      data: {
        kind: 'memory',
        words,
        source_path: data.value.sourcePath,
        preview_offset: data.value.previewOffset,
      },
    },
  })
}

async function loadMemoryImage() {
  const current = config.value ?? { mode: 'ram' as CanvasMemoryMode, addressWidth: 8, dataWidth: 8 }

  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: 'Memory Image',
          extensions: ['hex', 'mem', 'mif', 'coe', 'txt', 'bin', 'rom', 'ram'],
        },
      ],
    })

    if (typeof selected !== 'string') {
      return
    }

    const parsed = await loadHardwareMemoryImage(selected, current.dataWidth)
    const requiredWidth = requiredMemoryAddressWidth(parsed.words.length)
    const nextAddressWidth = Math.max(current.addressWidth, requiredWidth)
    const wordCount = memoryWordCount(nextAddressWidth)
    const words = Array.from({ length: wordCount }, (_, index) => parsed.words[index] ?? 0)

    addressWidthInput.value = String(nextAddressWidth)
    previewOffsetInput.value = '0'

    upsert({
      ...props.device,
      state: {
        ...props.device.state,
        binding: resizeCanvasSlotBindings(
          props.device,
          memorySlotCount(current.mode, nextAddressWidth, current.dataWidth),
        ),
        config: {
          kind: 'memory',
          mode: current.mode,
          address_width: nextAddressWidth,
          data_width: current.dataWidth,
        },
        data: {
          kind: 'memory',
          words,
          source_path: parsed.source_path,
          preview_offset: 0,
        },
      },
    })
  } catch (err) {
    window.alert(`Failed to load memory image: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function clearMemoryData() {
  const wordCount = memoryWordCount(config.value?.addressWidth ?? 8)
  previewOffsetInput.value = '0'
  upsert({
    ...props.device,
    state: {
      ...props.device.state,
      data: {
        kind: 'memory',
        words: Array.from({ length: wordCount }, () => 0),
        source_path: null,
        preview_offset: 0,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">ROM / RAM</p>
    <Select
      :model-value="config?.mode ?? 'ram'"
      @update:model-value="(value) => commitMemoryMode(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="rom">ROM</SelectItem>
        <SelectItem value="ram">RAM</SelectItem>
      </SelectContent>
    </Select>
    <div class="grid grid-cols-2 gap-3">
      <Input
        v-model="addressWidthInput"
        type="number"
        min="1"
        :max="CANVAS_MEMORY_MAX_ADDRESS_WIDTH"
        @blur="commitMemoryGeometry"
        @keydown.enter.prevent="commitMemoryGeometry"
      />
      <Input
        v-model="dataWidthInput"
        type="number"
        min="1"
        max="16"
        @blur="commitMemoryGeometry"
        @keydown.enter.prevent="commitMemoryGeometry"
      />
    </div>
    <div class="flex gap-2">
      <Button variant="outline" class="flex-1" @click="loadMemoryImage">Load file</Button>
      <Button variant="outline" class="flex-1" @click="clearMemoryData">Clear data</Button>
    </div>
    <div
      class="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground"
    >
      <div class="font-medium text-foreground">{{ t('memoryImageFormatsTitle') }}</div>
      <div class="mt-1">{{ t('memoryImageFormatsVivado') }}</div>
      <div>{{ t('memoryImageFormatsQuartus') }}</div>
      <div>{{ t('memoryImageFormatsBinary') }}</div>
      <div>{{ t('memoryImageFormatsPlainText') }}</div>
    </div>
    <div
      class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <div>{{ getCanvasMemoryWordsData(device).length }} words allocated</div>
      <div class="truncate">
        Source:
        <span class="text-foreground">{{ memorySourceLabel ?? 'inline / zero-initialized' }}</span>
      </div>
    </div>
    <div class="space-y-2 rounded-md border border-border/70 bg-background/70 p-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Preview window
        </p>
        <Input
          v-model="previewOffsetInput"
          type="number"
          min="0"
          class="h-8 w-28 font-mono"
          @blur="commitMemoryPreviewOffset"
          @keydown.enter.prevent="commitMemoryPreviewOffset"
        />
      </div>
      <div class="grid max-h-72 gap-2 overflow-auto">
        <label
          v-for="row in memoryPreviewRows"
          :key="row.index"
          class="flex items-center gap-3 rounded border border-border/70 bg-muted/20 px-3 py-2"
        >
          <span class="w-16 shrink-0 font-mono text-xs text-muted-foreground">
            {{ formatMemoryAddress(row.index, config?.addressWidth ?? 8) }}
          </span>
          <Input
            class="h-8 min-w-0 flex-1 font-mono"
            :value="formatMemoryWord(row.value, config?.dataWidth ?? 8)"
            @change="commitMemoryPreviewWord(row.index, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>
  </section>
</template>
