<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { confirmAction } from '@/lib/confirm-action'
import { settingsStore } from '@/stores/settings'

const props = defineProps<{
  id: string
  x: number
  y: number
  label: string
  selected?: boolean
  width?: number
  height?: number
  boundSignal?: string
  scale?: number
  preview?: boolean
  animated?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:position', x: number, y: number): void
  (e: 'select', id: string, multi: boolean): void
  (e: 'open-settings', id: string): void
  (e: 'delete', id: string): void
  (e: 'drag-end', id: string, x: number, y: number): void
}>()

const el = ref<HTMLElement | null>(null)
const dragState = ref<{
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  currentX: number
  currentY: number
} | null>(null)

function onMouseDown(e: MouseEvent) {
  if (props.preview) {
    return
  }

  e.stopPropagation()
  emit('select', props.id, e.shiftKey || e.metaKey)
}

function openSettings() {
  emit('select', props.id, false)
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

function requestRemoveDevice() {
  deferContextAction(async () => {
    if (
      settingsStore.state.confirmDelete &&
      !(await confirmAction(`Are you sure you want to delete ${props.label}?`, {
        title: 'Delete Device',
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
  if (props.preview) {
    return
  }

  if (e.button !== 0) {
    return
  }

  e.preventDefault()
  e.stopPropagation()
  emit('select', props.id, e.shiftKey || e.metaKey)

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
        <!-- Selection Ring -->
        <div
          class="absolute -inset-1 rounded-lg border-2 border-primary transition-opacity pointer-events-none"
          :class="selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'"
        ></div>

        <!-- Content -->
        <div
          class="relative bg-card border border-border rounded-md shadow-sm overflow-hidden"
          :class="props.preview ? 'border-primary/60 ring-1 ring-primary/30' : ''"
        >
          <!-- Drag Handle / Header -->
          <div
            class="h-2 w-full bg-muted/50 flex items-center justify-center"
            :class="props.preview ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing'"
            @pointerdown="startDrag"
          >
            <!-- Signal Indicator -->
            <div
              v-if="props.boundSignal"
              class="h-1 w-8 bg-green-500 rounded-full opacity-80"
              :title="props.boundSignal"
            ></div>
          </div>
          <div class="p-2">
            <slot />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-48">
        <ContextMenuItem @select="requestOpenSettings">Settings</ContextMenuItem>
        <ContextMenuItem class="text-destructive" @select="requestRemoveDevice">
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
