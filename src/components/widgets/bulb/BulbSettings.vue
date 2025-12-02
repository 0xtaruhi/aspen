<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">Power</span>
            <Switch :checked="Boolean(state.power)" @update:checked="onTogglePower" />
        </div>
        <div class="space-y-3">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">Color</span>
            <div class="flex items-center gap-2">
                <button
                    v-for="color in colorChoices"
                    :key="color"
                    :style="{ background: color }"
                    :class="['h-6 w-6 rounded-full border transition', isActiveColor(color) ? 'border-amber-400 ring-2 ring-amber-300/60' : 'border-zinc-200 dark:border-zinc-700']"
                    type="button"
                    @click="selectColor(color)"
                />
                <label
                    class="relative grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-dashed border-zinc-300 text-[11px] font-medium text-zinc-500 dark:border-zinc-700">
                    <input
                        type="color"
                        class="absolute inset-0 cursor-pointer opacity-0"
                        :value="String(state.color ?? '#ffffff')"
                        @input="onCustomColorInput"
                    />
                    +
                </label>
            </div>
        </div>
        <div class="space-y-3">
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-zinc-700 dark:text-zinc-200">Brightness</span>
                <span class="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{{ brightnessPercent }}%</span>
            </div>
            <Slider
                :min="0"
                :max="1"
                :step="0.01"
                :model-value="[Number(state.brightness ?? 0)]"
                @update:model-value="onBrightnessChange"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"

import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"

import type { WidgetDefinition } from "../registry"

type BulbState = {
    power?: boolean
    color?: string
    brightness?: number
    size?: number
}

type Props = {
    state: BulbState
    definition?: WidgetDefinition
}

const props = defineProps<Props>()
const emit = defineEmits<{ (e: "update", patch: Partial<BulbState>): void }>()

const presetColors = computed(() => {
    const hint = props.definition?.meta?.presetColors
    if (Array.isArray(hint)) {
        return hint.map(color => String(color))
    }

    return ["#fbbf24", "#60a5fa", "#34d399", "#f472b6", "#f87171", "#a78bfa"]
})

const colorChoices = ref<string[]>([...presetColors.value])

watch(presetColors, newColors => {
    const merged = new Set([...newColors, ...colorChoices.value])
    colorChoices.value = Array.from(merged)
})

watch(() => props.state.color, value => {
    if (typeof value === "string") {
        ensureColor(value)
    }
})

const brightnessPercent = computed(() => {
    const value = Number(props.state.brightness ?? 0)
    return Math.round(Math.min(Math.max(value, 0), 1) * 100)
})

function emitUpdate(patch: Partial<BulbState>) {
    emit("update", patch)
}

function onTogglePower(value: boolean) {
    emitUpdate({ power: value })
}

function ensureColor(color: string) {
    const normalized = color.toLowerCase()
    if (!colorChoices.value.some(item => item.toLowerCase() === normalized)) {
        colorChoices.value.unshift(color)
    }
}

function selectColor(color: string) {
    ensureColor(color)
    emitUpdate({ color })
}

function onCustomColorInput(event: Event) {
    const target = event.target as HTMLInputElement | null
    if (!target) {
        return
    }
    onCustomColor(target.value)
}

function onCustomColor(color: string) {
    ensureColor(color)
    emitUpdate({ color })
}

function isActiveColor(color: string) {
    return typeof props.state.color === "string" && props.state.color.toLowerCase() === color.toLowerCase()
}

function onBrightnessChange(values: number[] | undefined) {
    if (!Array.isArray(values) || values.length === 0) {
        return
    }

    onBrightness(values[0])
}

function onBrightness(value: number | undefined) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return
    }

    emitUpdate({ brightness: Math.min(Math.max(value, 0), 1) })
}
</script>
