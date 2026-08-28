<script setup lang="ts">
import type { ProjectStarterCatalogEntry } from '@/lib/project-starters'

import { Check, Cpu, FileCode2, Sparkles } from '@lucide/vue'

import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  entry: ProjectStarterCatalogEntry
  selected: boolean
}>()

defineEmits<{
  (e: 'select', entry: ProjectStarterCatalogEntry): void
}>()

const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    role="radio"
    :aria-checked="selected"
    class="group relative min-h-32 overflow-hidden rounded-md border bg-background/60 p-3.5 text-left transition-[border-color,background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:border-foreground/25 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    :class="
      selected
        ? 'border-primary/70 bg-primary/[0.045] shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_25%,transparent)]'
        : 'border-border/70'
    "
    @click="$emit('select', props.entry)"
  >
    <span
      class="absolute inset-y-0 left-0 w-0.5 transition-colors"
      :class="
        entry.category === 'showcase'
          ? 'bg-amber-400/80'
          : entry.category === 'device-lab'
            ? 'bg-cyan-400/70'
            : 'bg-muted-foreground/35'
      "
    />

    <span class="mb-3 flex items-center justify-between gap-3">
      <span class="flex items-center gap-2 text-muted-foreground">
        <FileCode2 v-if="entry.category === 'template'" class="size-4" />
        <Cpu v-else-if="entry.category === 'device-lab'" class="size-4" />
        <Sparkles v-else class="size-4" />
        <span class="font-mono text-[10px] tracking-[0.16em]">{{ entry.code }}</span>
      </span>
      <span
        class="grid size-5 place-items-center rounded-full border transition-colors"
        :class="
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border/80 text-transparent'
        "
      >
        <Check class="size-3" />
      </span>
    </span>

    <span class="block text-sm font-semibold text-foreground">{{ t(entry.titleKey) }}</span>
    <span class="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
      {{ t(entry.descriptionKey) }}
    </span>

    <Badge
      variant="outline"
      class="mt-3 rounded-sm border-border/70 px-1.5 py-0 font-mono text-[9px] tracking-wider text-muted-foreground uppercase"
    >
      {{
        t(
          entry.category === 'template'
            ? 'starterCode'
            : entry.category === 'device-lab'
              ? 'deviceLab'
              : 'showcase',
        )
      }}
    </Badge>
  </button>
</template>
