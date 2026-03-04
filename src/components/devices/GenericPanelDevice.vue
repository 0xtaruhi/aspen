<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="w-full h-full min-w-20 min-h-16 rounded-md border border-zinc-700 bg-zinc-900/70 p-2">
    <div class="text-[10px] text-zinc-300 font-medium leading-tight">{{ title }}</div>
    <div class="mt-2 h-8 rounded bg-zinc-800/80 border border-zinc-700"></div>
  </div>
</template>
