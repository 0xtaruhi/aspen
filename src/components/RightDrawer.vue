<template>
  <div>
    <div @click="toggle(true)">
      <slot name="trigger" />
    </div>

    <teleport to="body">
      <transition name="rd-overlay">
        <div v-if="modelValue" class="rd-overlay" @click="toggle(false)" />
      </transition>

      <transition name="rd-panel">
        <aside v-if="modelValue" class="rd-panel" :style="panelStyle" @click.stop>
          <header v-if="title" class="rd-header rd-header-border">
            <div class="rd-title">{{ title }}</div>
          </header>
          <div class="rd-content rd-content-polish">
            <slot />
          </div>
        </aside>
      </transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Props = {
  modelValue: boolean
  title?: string
  description?: string
  width?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  title: '',
  description: '',
  width: 360,
})

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

function toggle(v: boolean) {
  emit('update:modelValue', v)
}

const panelStyle = computed(() => ({ width: props.width + 'px' }))
</script>

<style scoped>
.rd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 50;
}

.rd-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background:
    linear-gradient(to bottom, color-mix(in oklab, white 8%, transparent), transparent 28px),
    var(--window-drawer-surface);
  color: var(--popover-foreground);
  z-index: 51;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  -webkit-backdrop-filter: saturate(135%) blur(10px);
  backdrop-filter: saturate(135%) blur(10px);
  box-shadow:
    -14px 0 32px color-mix(in oklab, black 14%, transparent),
    inset 1px 0 0 color-mix(in oklab, white 8%, transparent);
}

.rd-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
}

.rd-header-border {
  border-bottom: 1px solid var(--border);
}

.rd-title {
  font-size: 14px;
  font-weight: 600;
}

.rd-close {
  height: 28px;
  width: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.rd-desc {
  font-size: 12px;
  opacity: 0.8;
  padding: 0 12px 8px 12px;
}

.rd-content {
  padding: 12px;
  overflow: auto;
  flex: 1 1 auto;
  background: transparent;
}

.rd-content-polish {
  padding-top: 16px;
  padding-bottom: 16px;
}

.rd-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}

.rd-btn {
  font-size: 14px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
}

/* Transitions */
.rd-overlay-enter-active,
.rd-overlay-leave-active {
  transition: opacity 150ms ease;
}

.rd-overlay-enter-from,
.rd-overlay-leave-to {
  opacity: 0;
}

.rd-panel-enter-active,
.rd-panel-leave-active {
  transition: transform 210ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rd-panel-enter-from,
.rd-panel-leave-to {
  transform: translateX(100%);
}
</style>
