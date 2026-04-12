<template>
  <transition name="cg-overlay">
    <div v-if="open" class="cg-overlay" @pointerdown.self="emit('close')">
      <div ref="panelRef" class="cg-panel">
        <div class="cg-sections">
          <section v-for="section in sections" :key="section.id" class="cg-section">
            <div class="cg-section-header">
              <p class="cg-section-title">{{ section.title }}</p>
            </div>
            <div class="cg-grid">
              <div
                v-for="item in section.items"
                :key="item.type"
                class="cg-item"
                :title="item.title"
                @pointerdown="beginPaletteDrag(item.type, $event)"
              >
                <div class="cg-card">
                  <div class="cg-icon">
                    <component :is="item.icon" class="cg-icon-svg" />
                  </div>
                  <div class="cg-copy">
                    <div class="cg-label">{{ item.title }}</div>
                    <div class="cg-meta">{{ item.meta }}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { listCanvasDeviceGallerySections } from '@/components/virtual-device/registry'
import { useI18n } from '@/lib/i18n'
import { beginPaletteDrag } from '@/stores/palette-drag'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
}>()
const { t } = useI18n()
const panelRef = ref<HTMLElement | null>(null)

function handleWindowClick(event: MouseEvent) {
  if (!props.open) {
    return
  }

  const target = event.target
  if (!(target instanceof Node)) {
    return
  }

  if (panelRef.value?.contains(target)) {
    return
  }

  emit('close')
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('click', handleWindowClick)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', handleWindowClick)
  }
})

const sections = computed(() => {
  return listCanvasDeviceGallerySections().map((section) => ({
    ...section,
    title: t(section.titleKey),
  }))
})
</script>

<style scoped>
.cg-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: auto;
  background: color-mix(in oklab, var(--background) 82%, transparent);
}

.cg-panel {
  position: absolute;
  inset: 0 0 auto 0;
  max-height: min(48vh, 420px);
  overflow: auto;
  border-bottom: 1px solid var(--border);
  background: var(--window-panel-surface);
}

.cg-sections {
  display: grid;
  gap: 14px;
  padding: 14px 16px 18px;
}

.cg-section {
  display: grid;
  gap: 10px;
}

.cg-section-header {
  display: flex;
  align-items: center;
}

.cg-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--muted-foreground);
  text-transform: uppercase;
}

.cg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.cg-item {
  display: inline-flex;
}

.cg-card {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 64px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: grab;
  user-select: none;
  background: var(--card);
  color: var(--card-foreground);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.cg-card:hover {
  border-color: color-mix(in oklab, var(--primary) 34%, var(--border));
  background: color-mix(in oklab, var(--card) 92%, var(--primary) 8%);
  transform: translateY(-1px);
}

.cg-card:active {
  cursor: grabbing;
}

.cg-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
  background: color-mix(in oklab, var(--muted) 82%, transparent);
}

.cg-icon-svg {
  width: 18px;
  height: 18px;
}

.cg-copy {
  min-width: 0;
}

.cg-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.cg-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted-foreground);
}

.cg-overlay-enter-active,
.cg-overlay-leave-active {
  transition: opacity 180ms ease;
}

.cg-overlay-enter-from,
.cg-overlay-leave-to {
  opacity: 0;
}
</style>
