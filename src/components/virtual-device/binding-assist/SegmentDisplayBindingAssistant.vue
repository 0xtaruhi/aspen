<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCanvasSegmentDisplayConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import type { IndexedSignalBus } from '@/components/virtual-device/types'
import { guessIndexedBus } from '@/components/virtual-device/settings/shared'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()
const segmentBusInput = ref('')
const digitBusInput = ref('')

const config = computed(() => getCanvasSegmentDisplayConfig(props.device))
const segmentBusOptions = computed(() =>
  props.indexedCompatibleBuses.filter((bus) => bus.width >= 8),
)
const digitBusOptions = computed(() => {
  const digits = config.value?.digits ?? 0
  return props.indexedCompatibleBuses.filter((bus) => bus.width >= digits)
})

function findIndexedBus(baseName: string) {
  return props.indexedCompatibleBuses.find((bus) => bus.baseName === baseName) ?? null
}

watch(
  () => ({
    id: props.device.id,
    digits: config.value?.digits ?? 0,
    buses: props.indexedCompatibleBuses.map((bus) => `${bus.baseName}:${bus.width}`).join('|'),
  }),
  () => {
    segmentBusInput.value = guessIndexedBus(props.indexedCompatibleBuses, 8, ['segment', 'seg'])
    digitBusInput.value =
      (config.value?.digits ?? 1) > 1
        ? guessIndexedBus(
            props.indexedCompatibleBuses,
            config.value?.digits ?? 0,
            ['sel', 'digit'],
            segmentBusInput.value,
          )
        : ''
  },
  { immediate: true },
)

async function applyBusBindings() {
  const digits = config.value?.digits ?? 1
  const segmentBus = findIndexedBus(segmentBusInput.value)
  if (!segmentBus) {
    return
  }

  const operations: Promise<unknown>[] = []
  for (let segmentIndex = 0; segmentIndex < 8; segmentIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        segmentIndex,
        segmentBus.signals[segmentIndex] ?? null,
      ),
    )
  }

  if (digits > 1) {
    const digitBus = findIndexedBus(digitBusInput.value)
    if (!digitBus) {
      return
    }

    for (let digitIndex = 0; digitIndex < digits; digitIndex += 1) {
      operations.push(
        hardwareStore.bindCanvasSignalSlot(
          props.device.id,
          8 + digitIndex,
          digitBus.signals[digitIndex] ?? null,
        ),
      )
    }
  }

  await Promise.all(operations)
}
</script>

<template>
  <div class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
    <div>
      <p class="text-sm font-medium">{{ t('quickBind') }}</p>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">
        {{ t('quickBindDescription') }}
      </p>
    </div>
    <div class="space-y-3">
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">{{ t('segmentBus') }}</p>
        <Select
          :model-value="segmentBusInput"
          @update:model-value="(value) => (segmentBusInput = String(value))"
        >
          <SelectTrigger class="w-full"
            ><SelectValue :placeholder="t('chooseBus')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="bus in segmentBusOptions"
              :key="`segment-${bus.baseName}`"
              :value="bus.baseName"
            >
              <span class="font-mono text-xs">{{ bus.label }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div v-if="(config?.digits ?? 1) > 1" class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">{{ t('digitSelectBus') }}</p>
        <Select
          :model-value="digitBusInput"
          @update:model-value="(value) => (digitBusInput = String(value))"
        >
          <SelectTrigger class="w-full"
            ><SelectValue :placeholder="t('chooseBus')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="bus in digitBusOptions"
              :key="`digit-${bus.baseName}`"
              :value="bus.baseName"
            >
              <span class="font-mono text-xs">{{ bus.label }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <Button
      variant="outline"
      class="w-full"
      :disabled="!segmentBusInput || ((config?.digits ?? 1) > 1 && !digitBusInput)"
      @click="applyBusBindings"
    >
      {{ t('applyBusBindings') }}
    </Button>
    <p
      v-if="
        segmentBusOptions.length === 0 ||
        ((config?.digits ?? 1) > 1 && digitBusOptions.length === 0)
      "
      class="text-xs leading-5 text-muted-foreground"
    >
      {{ t('noMatchingBuses') }}
    </p>
  </div>
</template>
