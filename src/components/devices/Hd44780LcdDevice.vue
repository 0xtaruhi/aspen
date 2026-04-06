<script setup lang="ts">
const props = defineProps<{
  columns: number
  rows: number
  lines: string[]
}>()

function displayLine(index: number) {
  return (props.lines[index] ?? '').padEnd(props.columns, ' ').slice(0, props.columns)
}
</script>

<template>
  <div class="flex h-full w-full items-center justify-center p-2">
    <div
      class="w-full rounded-md border border-black/15 bg-[linear-gradient(180deg,#2f5d46,#244736)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div
        class="rounded-[3px] border border-black/20 bg-[#9ecf86] px-2.5 py-1.5 font-mono text-[13px] tracking-[0.16em] text-[#173122] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
      >
        <div v-for="index in rows" :key="index" class="min-h-6 whitespace-pre">
          {{ displayLine(index - 1) }}
        </div>
      </div>
    </div>
  </div>
</template>
