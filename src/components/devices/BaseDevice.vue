<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { Settings2 } from 'lucide-vue-next'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { settingsStore } from '@/stores/settings'

type DeviceSelectionMode = 'preserve' | 'replace' | 'toggle'

const props = defineProps<{
  id: string
  x: number
  y: number
  label: string
  selected?: boolean
  width?: number
  height?: number
  boundSignal?: string
  boundSignalsCount?: number
  scale?: number
  preview?: boolean
  animated?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:position', x: number, y: number): void
  (e: 'select', id: string, mode: DeviceSelectionMode): void
  (e: 'open-settings', id: string): void
  (e: 'delete', id: string): void
  (e: 'drag-start', id: string): void
  (e: 'drag-end', id: string, x: number, y: number): void
  (e: 'rename', id: string, label: string): void
}>()
const { t } = useI18n()

const el = ref<HTMLElement | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const dragState = ref<{
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  currentX: number
  currentY: number
} | null>(null)
const isRenaming = ref(false)
const renameValue = ref('')
const suppressNextMouseDownSelection = ref(false)

watch(
  () => props.label,
  (nextLabel) => {
    if (!isRenaming.value) {
      renameValue.value = nextLabel
    }
  },
  { immediate: true },
)

function resolveSelectionMode(multiSelect: boolean): DeviceSelectionMode {
  if (multiSelect) {
    return 'toggle'
  }

  return 'replace'
}

function onMouseDown(e: MouseEvent) {
  if (props.preview) {
    return
  }

  if (suppressNextMouseDownSelection.value) {
    suppressNextMouseDownSelection.value = false
    return
  }

  e.stopPropagation()
  emit('select', props.id, resolveSelectionMode(e.shiftKey || e.metaKey))
}

function openSettings() {
  emit('select', props.id, 'replace')
  emit('open-settings', props.id)
}

function removeDevice() {
  emit('delete', props.id)
}

function deferContextAction(action: () => void | Promise<void>) {
  window.setTimeout(action, 0)
}

function requestOpenSettings() {
  deferContextAction(openSettings)
}

function handleSettingsButtonClick() {
  openSettings()
}

function startRename() {
  if (props.preview) {
    return
  }

  isRenaming.value = true
  renameValue.value = props.label
  void nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function commitRename() {
  if (!isRenaming.value) {
    return
  }

  const nextLabel = renameValue.value.trim()
  isRenaming.value = false

  if (!nextLabel || nextLabel === props.label) {
    renameValue.value = props.label
    return
  }

  emit('rename', props.id, nextLabel)
}

function cancelRename() {
  isRenaming.value = false
  renameValue.value = props.label
}

function requestRemoveDevice() {
  deferContextAction(async () => {
    if (
      settingsStore.state.confirmDelete &&
      !(await confirmAction(t('deleteDeviceConfirm', { name: props.label }), {
        title: t('deleteDeviceTitle'),
      }))
    ) {
      return
    }

    removeDevice()
  })
}

function stopDrag() {
  if (dragState.value && !props.preview) {
    emit('drag-end', props.id, dragState.value.currentX, dragState.value.currentY)
  }

  dragState.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

function onPointerMove(e: PointerEvent) {
  if (!dragState.value) {
    return
  }

  const scale = props.scale && props.scale > 0 ? props.scale : 1
  const nextX = dragState.value.startX + (e.clientX - dragState.value.pointerX) / scale
  const nextY = dragState.value.startY + (e.clientY - dragState.value.pointerY) / scale
  dragState.value.currentX = nextX
  dragState.value.currentY = nextY
  emit('update:position', nextX, nextY)
}

function startDrag(e: PointerEvent) {
  if (props.preview || isRenaming.value || e.button !== 0) {
    return
  }

  e.preventDefault()
  e.stopPropagation()

  suppressNextMouseDownSelection.value = true
  emit(
    'select',
    props.id,
    e.shiftKey || e.metaKey ? 'toggle' : props.selected ? 'preserve' : 'replace',
  )
  emit('drag-start', props.id)

  dragState.value = {
    startX: props.x,
    startY: props.y,
    pointerX: e.clientX,
    pointerY: e.clientY,
    currentX: props.x,
    currentY: props.y,
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    stopDrag()
  }
})
</script>

<template>
  <div
    ref="el"
    class="absolute select-none group"
    :class="props.preview ? 'pointer-events-none z-20 opacity-60 saturate-75 drop-shadow-xl' : ''"
    :style="{
      transform: `translate(${x}px, ${y}px)`,
      transition: animated ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
      width: width ? `${width}px` : 'auto',
      height: height ? `${height}px` : 'auto',
    }"
    @mousedown="onMouseDown"
  >
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          class="absolute -inset-1 rounded-lg border-2 border-primary transition-opacity pointer-events-none"
          :class="selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'"
        ></div>

        <div
          class="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card"
          :class="props.preview ? 'border-primary/60 ring-1 ring-primary/30' : ''"
        >
          <button
            v-if="!props.preview"
            type="button"
            class="absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground opacity-0 shadow-md transition hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100"
            :title="t('settingsAction')"
            :aria-label="t('settingsAction')"
            @mousedown.stop
            @click.stop="handleSettingsButtonClick"
          >
            <Settings2 class="h-3.5 w-3.5" />
          </button>

          <div
            class="flex min-h-10 w-full items-center gap-3 border-b border-border/70 bg-muted/45 px-3 py-2"
            :class="props.preview ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'"
            @pointerdown="startDrag"
          >
            <div class="min-w-0 flex-1">
              <Input
                v-if="isRenaming"
                ref="renameInputRef"
                v-model="renameValue"
                class="h-7 border-border/70 bg-background/90 px-2 text-sm font-medium"
                @click.stop
                @pointerdown.stop
                @blur="commitRename"
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
              />
              <button
                v-else
                type="button"
                class="block max-w-full truncate text-sm font-medium text-foreground"
                @click.stop
                @dblclick.stop="startRename"
              >
                {{ props.label }}
              </button>
            </div>
          </div>
          <div class="min-h-0 flex-1 p-2">
            <slot />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-48">
        <ContextMenuItem @select="requestOpenSettings">{{ t('settingsAction') }}</ContextMenuItem>
        <ContextMenuItem class="text-destructive" @select="requestRemoveDevice">
          {{ t('delete') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
