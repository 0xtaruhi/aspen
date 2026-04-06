<script setup lang="ts">
const props = defineProps<{
  mode: string
  addressWidth: number
  dataWidth: number
  wordCount: number
  sourcePath?: string | null
  liveAddress?: number | null
  liveOutputWord?: number | null
}>()

function hexWidth(bits: number) {
  return Math.max(2, Math.ceil(bits / 4))
}

function sourceLabel() {
  if (!props.sourcePath) {
    return 'inline'
  }

  const normalized = props.sourcePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}
</script>

<template>
  <div class="flex h-full w-full flex-col gap-3 p-3">
    <div class="rounded-md border border-border/70 bg-muted/25 px-3 py-2">
      <div class="flex items-center justify-between gap-3">
        <div class="text-sm font-semibold tracking-[0.08em] text-foreground">
          {{ mode.toUpperCase() }}
        </div>
        <div class="font-mono text-xs text-muted-foreground">{{ wordCount }} × {{ dataWidth }}</div>
      </div>
      <div class="mt-1 font-mono text-[11px] text-muted-foreground">AW={{ addressWidth }}</div>
      <div class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
        {{ sourceLabel() }}
      </div>
    </div>

    <div class="rounded-md border border-border/70 bg-background/70 px-3 py-2 font-mono text-xs">
      <div class="flex items-center justify-between gap-3 text-muted-foreground">
        <span>A</span>
        <span v-if="liveAddress !== null && liveAddress !== undefined" class="text-foreground">
          {{ liveAddress.toString(16).toUpperCase().padStart(hexWidth(addressWidth), '0') }}
        </span>
        <span v-else>--</span>
      </div>
      <div class="mt-2 flex items-center justify-between gap-3 text-muted-foreground">
        <span>Q</span>
        <span
          v-if="liveOutputWord !== null && liveOutputWord !== undefined"
          class="text-foreground"
        >
          {{ liveOutputWord.toString(16).toUpperCase().padStart(hexWidth(dataWidth), '0') }}
        </span>
        <span v-else>--</span>
      </div>
    </div>
  </div>
</template>
