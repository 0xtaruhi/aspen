<script setup lang="ts">
const props = defineProps<{
  width: number
  bits: boolean[]
  color?: string
}>()

function bitValue(index: number) {
  return props.bits[index] ?? false
}
</script>

<template>
  <div class="flex h-full w-full items-center justify-center px-3 py-3">
    <div
      class="grid w-full gap-2"
      :style="{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` }"
    >
      <div v-for="index in width" :key="index" class="flex flex-col items-center gap-2">
        <div
          class="device-panel-slot h-8 w-full rounded-sm transition-all duration-150"
          :style="
            bitValue(index - 1)
              ? { backgroundColor: color ?? '#4ade80', boxShadow: `0 0 18px ${color ?? '#4ade80'}` }
              : undefined
          "
        />
        <span class="device-panel-label-dim text-[10px]">
          {{ index - 1 }}
        </span>
      </div>
    </div>
  </div>
</template>
