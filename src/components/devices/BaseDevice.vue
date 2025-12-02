<script setup lang="ts">
import { ref } from 'vue'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@/components/ui/context-menu'
import { projectStore } from '@/stores/project'

const props = defineProps<{
  id: string
  x: number
  y: number
  selected?: boolean
  width?: number
  height?: number
}>()

const emit = defineEmits<{
  (e: 'update:position', x: number, y: number): void
  (e: 'select', id: string, multi: boolean): void
}>()

const el = ref<HTMLElement | null>(null)

function onMouseDown(e: MouseEvent) {
  e.stopPropagation()
  emit('select', props.id, e.shiftKey || e.metaKey)
}

const boundSignal = ref<string | null>(null)

function bindSignal(signalName: string) {
    boundSignal.value = signalName
    console.log(`Bound device ${props.id} to signal ${signalName}`)
}

</script>

<template>
  <div
    ref="el"
    class="absolute select-none group"
    :style="{
      transform: `translate(${x}px, ${y}px)`,
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
            <div class="relative bg-card border border-border rounded-md shadow-sm overflow-hidden">
                <!-- Drag Handle / Header -->
                <div class="h-2 w-full bg-muted/50 cursor-grab active:cursor-grabbing flex items-center justify-center">
                    <!-- Signal Indicator -->
                    <div v-if="boundSignal" class="h-1 w-8 bg-green-500 rounded-full opacity-80" :title="boundSignal"></div>
                </div>
                <div class="p-2">
                    <slot />
                </div>
            </div>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-48">
            <ContextMenuItem>Properties</ContextMenuItem>
            <ContextMenuSub>
                <ContextMenuSubTrigger>Bind to Signal</ContextMenuSubTrigger>
                <ContextMenuSubContent class="w-48">
                    <ContextMenuItem 
                        v-for="sig in projectStore.signals" 
                        :key="sig.name"
                        @select="bindSignal(sig.name)"
                    >
                        <span class="font-mono text-xs">{{ sig.name }}</span>
                        <span class="ml-auto text-xs text-muted-foreground">{{ sig.direction }}</span>
                    </ContextMenuItem>
                    <ContextMenuItem v-if="projectStore.signals.length === 0" disabled>
                        No signals found
                    </ContextMenuItem>
                </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem class="text-destructive">Delete</ContextMenuItem>
        </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
