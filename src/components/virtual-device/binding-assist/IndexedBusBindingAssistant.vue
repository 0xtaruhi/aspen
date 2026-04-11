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
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'
import { applySelectedIndexedBusGroups } from '@/components/virtual-device/binding-assist/indexed-bus-utils'
import { replaceCanvasSlotBindings } from '@/components/virtual-device/settings/shared'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
  groups: IndexedBusBindingGroup[]
}>()

const { t } = useI18n()
const UNBOUND_BUS = '__unbound_bus__'

const selectedBuses = ref<Record<string, string>>({})

const visibleGroups = computed(() => {
  return props.groups.filter((group) => group.width > 0)
})

const groupOptions = computed(() => {
  return Object.fromEntries(
    visibleGroups.value.map((group) => [
      group.key,
      props.indexedCompatibleBuses.filter((bus) => bus.width >= group.width),
    ]),
  ) as Record<string, IndexedSignalBus[]>
})

function groupSelectionValue(groupKey: string) {
  return selectedBuses.value[groupKey] ?? UNBOUND_BUS
}

function setGroupSelection(groupKey: string, value: string) {
  selectedBuses.value = {
    ...selectedBuses.value,
    [groupKey]: value,
  }
}

function findIndexedBus(baseName: string) {
  if (!baseName || baseName === UNBOUND_BUS) {
    return null
  }

  return props.indexedCompatibleBuses.find((bus) => bus.baseName === baseName) ?? null
}

function guessGroupBus(group: IndexedBusBindingGroup, excludeBaseNames: ReadonlySet<string>) {
  const narrowed = props.indexedCompatibleBuses.filter((bus) => {
    return bus.width >= group.width && !excludeBaseNames.has(bus.baseName)
  })

  for (const keyword of group.keywords) {
    const match = narrowed.find((bus) => bus.baseName.toLowerCase().includes(keyword))
    if (match) {
      return match.baseName
    }
  }

  return narrowed[0]?.baseName ?? ''
}

function bindingSliceMatchesBus(group: IndexedBusBindingGroup, bus: IndexedSignalBus) {
  if (props.device.state.binding.kind !== 'slots') {
    return false
  }

  for (let index = 0; index < group.width; index += 1) {
    if (
      props.device.state.binding.signals[group.slotOffset + index] !== (bus.signals[index] ?? null)
    ) {
      return false
    }
  }

  return true
}

function selectionFromExistingBinding(group: IndexedBusBindingGroup) {
  return (
    (groupOptions.value[group.key] ?? []).find((bus) => bindingSliceMatchesBus(group, bus))
      ?.baseName ?? ''
  )
}

const hasAnyMatchingBuses = computed(() => {
  return visibleGroups.value.some((group) => (groupOptions.value[group.key] ?? []).length > 0)
})

const hasAnySelections = computed(() => {
  return visibleGroups.value.some((group) =>
    Boolean(findIndexedBus(groupSelectionValue(group.key))),
  )
})

watch(
  () => ({
    id: props.device.id,
    binding:
      props.device.state.binding.kind === 'slots'
        ? props.device.state.binding.signals.join('|')
        : '',
    groups: visibleGroups.value
      .map((group) => `${group.key}:${group.width}:${group.slotOffset}:${group.keywords.join(',')}`)
      .join('|'),
    buses: props.indexedCompatibleBuses.map((bus) => `${bus.baseName}:${bus.width}`).join('|'),
  }),
  () => {
    const nextSelections: Record<string, string> = {}
    const usedBaseNames = new Set<string>()

    for (const group of visibleGroups.value) {
      const matched = selectionFromExistingBinding(group)
      if (matched) {
        usedBaseNames.add(matched)
        nextSelections[group.key] = matched
        continue
      }

      const guessed = guessGroupBus(group, usedBaseNames)
      if (guessed) {
        usedBaseNames.add(guessed)
      }
      nextSelections[group.key] = guessed || UNBOUND_BUS
    }

    selectedBuses.value = nextSelections
  },
  { immediate: true },
)

async function applyBusBindings() {
  if (props.device.state.binding.kind !== 'slots') {
    return
  }

  const { nextSignals, appliedGroupCount } = applySelectedIndexedBusGroups({
    currentSignals: props.device.state.binding.signals,
    groups: visibleGroups.value,
    selections: selectedBuses.value,
    buses: props.indexedCompatibleBuses,
  })

  if (appliedGroupCount === 0) {
    return
  }

  await hardwareStore.upsertCanvasDevice(replaceCanvasSlotBindings(props.device, nextSignals))
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

    <div class="grid gap-3 md:grid-cols-2">
      <div v-for="group in visibleGroups" :key="group.key" class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">{{ group.label }}</p>
        <Select
          :model-value="groupSelectionValue(group.key)"
          @update:model-value="(value) => setGroupSelection(group.key, String(value))"
        >
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="t('chooseBus')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="UNBOUND_BUS">
              {{ t('unbound') }}
            </SelectItem>
            <SelectItem
              v-for="bus in groupOptions[group.key] ?? []"
              :key="`${group.key}-${bus.baseName}`"
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
      :disabled="!hasAnyMatchingBuses || !hasAnySelections"
      @click="applyBusBindings"
    >
      {{ t('applyBusBindings') }}
    </Button>

    <p v-if="!hasAnyMatchingBuses" class="text-xs leading-5 text-muted-foreground">
      {{ t('noMatchingBuses') }}
    </p>
  </div>
</template>
