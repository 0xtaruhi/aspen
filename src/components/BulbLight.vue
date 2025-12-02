<template>
    <div class="flex flex-col items-center">
        <div :style="{ width: sizePx, height: sizePx }" class="relative select-none">
            <!-- Glow -->
            <div class="absolute inset-0 rounded-full" :style="{
                filter: `blur(${Math.max(size * 0.08, 6)}px)`,
                background: `radial-gradient(50% 50% at 50% 40%, ${colorWithOpacity(effectiveOpacity)} 0%, ${colorWithOpacity(0)} 70%)`,
                opacity: effectiveOpacity
            }" />
            <!-- Bulb SVG -->
            <svg :width="size" :height="size" :viewBox="`0 0 ${baseSize} ${baseSize}`" fill="none">
                <!-- Glass -->
                <defs>
                    <radialGradient :id="gradId" cx="50%" cy="40%" r="60%">
                        <stop offset="0%" :stop-color="color" :stop-opacity="effectiveOpacity" />
                        <stop offset="60%" :stop-color="color" :stop-opacity="effectiveOpacity * 0.4" />
                        <stop offset="100%" stop-color="#ffffff" :stop-opacity="0" />
                    </radialGradient>
                </defs>
                <g>
                    <!-- bulb glass -->
                    <ellipse :cx="baseSize / 2" :cy="baseSize * 0.42" :rx="baseSize * 0.26" :ry="baseSize * 0.28"
                        :fill="`url(#${gradId})`" />
                    <!-- highlight -->
                    <ellipse :cx="baseSize * 0.44" :cy="baseSize * 0.33" :rx="baseSize * 0.06" :ry="baseSize * 0.04"
                        fill="#fff" :opacity="0.6 * effectiveOpacity" />
                    <!-- stem -->
                    <rect :x="baseSize * 0.46" :y="baseSize * 0.55" :width="baseSize * 0.08" :height="baseSize * 0.08"
                        :rx="baseSize * 0.01" fill="#a3a3a3" />
                    <!-- base (socket) -->
                    <g>
                        <rect :x="baseSize * 0.40" :y="baseSize * 0.63" :width="baseSize * 0.20"
                            :height="baseSize * 0.07" :rx="baseSize * 0.012" class="fill-zinc-300 dark:fill-zinc-600" />
                        <rect :x="baseSize * 0.405" :y="baseSize * 0.635" :width="baseSize * 0.19"
                            :height="baseSize * 0.01" class="fill-white/40 dark:fill-white/10" />
                        <rect :x="baseSize * 0.405" :y="baseSize * 0.675" :width="baseSize * 0.19"
                            :height="baseSize * 0.01" class="fill-black/10 dark:fill-black/40" />
                    </g>
                </g>
            </svg>
        </div>

    </div>
</template>

<script setup lang="ts">
import { computed } from "vue"

type Props = {
    color?: string
    brightness?: number // 0..1
    power?: boolean
    size?: number // px
}

const props = withDefaults(defineProps<Props>(), {
    color: "#fbbf24", // amber-400
    brightness: 0.9,
    power: true,
    size: 120,
})

const baseSize = 200

const size = computed(() => Math.max(props.size, 1))
const sizePx = computed(() => `${size.value}px`)

const clampedBrightness = computed(() => Math.min(Math.max(props.brightness, 0), 1))
const effectiveOpacity = computed(() => (props.power ? clampedBrightness.value : 0))

const gradId = `bulb-grad-${Math.random().toString(36).slice(2, 9)}`

function colorWithOpacity(opacity: number): string {
    const c = props.color.trim()
    if (c.startsWith("rgba") || c.startsWith("rgb")) {
        return c
    }

    let r = 255
    let g = 191
    let b = 36
    const hex = c.replace("#", "")

    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16)
        g = parseInt(hex[1] + hex[1], 16)
        b = parseInt(hex[2] + hex[2], 16)
    } else if (hex.length >= 6) {
        r = parseInt(hex.slice(0, 2), 16)
        g = parseInt(hex.slice(2, 4), 16)
        b = parseInt(hex.slice(4, 6), 16)
    }

    return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
</script>

<style scoped>
/* No extra styles needed; Tailwind utilities used for layout */
</style>
