<template>
  <transition name="cg-overlay">
    <div v-if="open" class="cg-overlay">
      <div class="cg-ribbon">
        <div class="cg-inner">
          <div
            class="cg-item"
            v-for="item in items"
            :key="item.type"
            @pointerdown="beginPaletteDrag(item.type, $event)"
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
import {
  CircleDot,
  Grid2x2,
  Grid3X3,
  Grid3x3,
  Keyboard,
  Lightbulb,
  Monitor,
  RotateCw,
  Square,
  ToggleLeft,
  Type,
} from 'lucide-vue-next'

import { beginPaletteDrag } from '@/stores/palette-drag'

type GalleryItem = { type: string; title: string; icon: any }

defineProps<{ open: boolean }>()

const items = computed<GalleryItem[]>(() => [
  { type: 'led', title: 'LED', icon: Lightbulb },
  { type: 'switch', title: 'Switch', icon: ToggleLeft },
  { type: 'button', title: 'Button', icon: CircleDot },
  { type: 'keypad', title: 'KeyPad', icon: Grid3x3 },
  { type: 'small_keypad', title: 'SmallKeyPad', icon: Grid2x2 },
  { type: 'rotary_button', title: 'RotaryButton', icon: RotateCw },
  { type: 'ps2_keyboard', title: 'PS2Keyboard', icon: Keyboard },
  { type: 'text_lcd', title: 'TextLCD', icon: Type },
  { type: 'graphic_lcd', title: 'GraphicLCD', icon: Monitor },
  { type: 'segment_display', title: 'SegmentDisplay', icon: Square },
  { type: 'four_digit_segment_display', title: '4DigitSegment', icon: Grid2x2 },
  { type: 'led4x4_matrix', title: 'LED4x4', icon: Grid3X3 },
  { type: 'led8x8_matrix', title: 'LED8x8', icon: Grid3X3 },
  { type: 'led16x16_matrix', title: 'LED16x16', icon: Grid3X3 },
])
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
  pointer-events: none;
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
  pointer-events: auto;
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
