<template>
  <transition name="cg-overlay">
    <div v-if="open" class="cg-overlay">
      <div class="cg-ribbon">
        <div class="cg-inner">
          <div
            class="cg-item"
            v-for="item in items"
            :key="item.type"
            :draggable="true"
            @dragstart="onDragStart(item.type)"
            :title="item.title"
          >
            <div class="cg-card">
              <div class="cg-icon">
                <component :is="item.icon" class="cg-icon-svg" />
              </div>
              <div class="cg-label">{{ item.title }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Lightbulb, ToggleLeft } from 'lucide-vue-next'

type GalleryItem = { type: string; title: string; icon: any }

defineProps<{ open: boolean }>()

const items = computed<GalleryItem[]>(() => [
  { type: 'led', title: 'LED', icon: Lightbulb },
  { type: 'switch', title: 'Switch', icon: ToggleLeft },
])

function onDragStart(type: string) {
  return (e: DragEvent) => {
    if (!e.dataTransfer) return
    e.dataTransfer.setData('application/x-widget', type)
    e.dataTransfer.effectAllowed = 'copy'
  }
}
</script>

<style scoped>
.cg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.1);
  z-index: 10;
}

@supports not (backdrop-filter: blur(1px)) {
  .cg-overlay {
    background: rgba(255, 255, 255, 0.9);
  }
}

.dark .cg-overlay {
  background: rgba(0, 0, 0, 0.1);
}

@supports not (backdrop-filter: blur(1px)) {
  .dark .cg-overlay {
    background: rgba(0, 0, 0, 0.8);
  }
}

.cg-ribbon {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: var(--popover);
  color: var(--popover-foreground);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(8px);
  z-index: 11;
}

.cg-inner {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  overflow-x: auto;
}

.cg-item {
  display: inline-flex;
}

.cg-card {
  display: grid;
  grid-template-columns: 28px auto;
  align-items: center;
  gap: 8px;
  height: 44px;
  min-width: 120px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: grab;
  user-select: none;
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}

.cg-card:active {
  cursor: grabbing;
}

.cg-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in oklab, var(--card) 70%, var(--foreground) 30%);
}

.cg-icon-svg {
  width: 16px;
  height: 16px;
}

.cg-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.cg-overlay-enter-active,
.cg-overlay-leave-active {
  transition: opacity 200ms ease;
}

.cg-overlay-enter-from,
.cg-overlay-leave-to {
  opacity: 0;
}
</style>
