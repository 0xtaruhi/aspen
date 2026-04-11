<script setup lang="ts">
const props = defineProps<{
  rows: number
  columns: number
  pressedRow: number | null
  pressedColumn: number | null
}>()

const emit = defineEmits<{
  (e: 'press-key', row: number | null, column: number | null): void
}>()

function keyLabel(row: number, column: number) {
  const labels = [
    ['1', '2', '3', 'A'],
    ['4', '5', '6', 'B'],
    ['7', '8', '9', 'C'],
    ['*', '0', '#', 'D'],
  ]
  return labels[row]?.[column] ?? `${row},${column}`
}

function isPressed(row: number, column: number) {
  return props.pressedRow === row && props.pressedColumn === column
}
</script>

<template>
  <div class="flex h-full w-full items-center justify-center px-1.5 py-1.5">
    <div
      class="rounded-md border border-zinc-800 bg-zinc-950/90 p-1.5"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    >
      <div
        class="grid gap-1"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      >
        <button
          v-for="index in rows * columns"
          :key="index"
          type="button"
          class="grid h-8 w-8 place-items-center rounded-sm border text-[10px] font-semibold transition-colors"
          :class="
            isPressed(Math.floor((index - 1) / columns), (index - 1) % columns)
              ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100'
              : 'border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
          "
          @click.stop="
            emit(
              'press-key',
              isPressed(Math.floor((index - 1) / columns), (index - 1) % columns)
                ? null
                : Math.floor((index - 1) / columns),
              isPressed(Math.floor((index - 1) / columns), (index - 1) % columns)
                ? null
                : (index - 1) % columns,
            )
          "
        >
          {{ keyLabel(Math.floor((index - 1) / columns), (index - 1) % columns) }}
        </button>
      </div>
    </div>
  </div>
</template>
