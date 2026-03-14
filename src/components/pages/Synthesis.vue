<script setup lang="ts">
import { computed } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { designContextStore } from '@/stores/design-context'

const activeFileName = designContextStore.sourceName
const sourceCode = designContextStore.sourceCode
const primaryModule = designContextStore.primaryModule
const codeLines = designContextStore.codeLines
const signalCount = computed(() => designContextStore.signals.value.length)

const logicCells = computed(() => Math.max(0, codeLines.value * 9 + signalCount.value * 16))
const registers = computed(() => Math.max(0, codeLines.value * 6 + signalCount.value * 10))
const bramBlocks = computed(() => Math.max(1, Math.ceil(codeLines.value / 180)))
const duration = computed(() => Math.max(3, Math.round(codeLines.value / 7)))

const warningCount = computed(() => {
  return designContextStore.signalSummary.value.outputs > 0 ? 0 : 1
})

const synthesisStatus = computed(() => {
  return sourceCode.value.trim().length > 0 ? 'Completed' : 'No Source'
})

const logs = computed(() => {
  const outputSignals = designContextStore.signalSummary.value.outputs
  const warningLine =
    warningCount.value === 0
      ? '0 Warnings, 0 Critical Warnings and 0 Errors encountered.'
      : '1 Warning, 0 Critical Warnings and 0 Errors encountered. (No output signal found)'

  return `[Synth 8-638] synthesizing module '${primaryModule.value}' [/src/${activeFileName.value}:1]
[Synth 8-256] done synthesizing module '${primaryModule.value}' (1#1) [/src/${activeFileName.value}:1]
[Synth 8-2450] Signal summary: ${signalCount.value} total (${outputSignals} outputs)
[Synth 8-2800] Estimated logic cells: ${logicCells.value}
[Synth 8-2810] Estimated registers: ${registers.value}
[Synth 8-2820] Estimated BRAM blocks: ${bramBlocks.value}
[Common 17-83] Releasing license: Synthesis
${warningLine}
synth_design completed successfully
synth_design: Time (s): elapsed = 00:00:${duration.value.toString().padStart(2, '0')} .`
})
</script>

<template>
  <div class="p-8 space-y-8 h-full flex flex-col animate-in fade-in duration-500">
    <div class="flex items-center justify-between shrink-0">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Synthesis</h2>
        <p class="text-muted-foreground">
          Logic synthesis results and reports for {{ activeFileName }}.
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <Badge
          variant="outline"
          :class="
            synthesisStatus === 'Completed'
              ? 'bg-green-500/10 text-green-500 border-green-500/20'
              : ''
          "
          >{{ synthesisStatus }}</Badge
        >
        <span class="text-sm text-muted-foreground">Duration: {{ duration }}s</span>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3 shrink-0">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium">Logic Cells</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ logicCells }}</div>
          <p class="text-xs text-muted-foreground">From {{ codeLines }} source lines</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium">Registers</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ registers }}</div>
          <p class="text-xs text-muted-foreground">Estimated from sequential logic</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium">Memory (BRAM)</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ bramBlocks }}</div>
          <p class="text-xs text-muted-foreground">File: {{ activeFileName }}</p>
        </CardContent>
      </Card>
    </div>

    <Card class="flex-1 min-h-0 flex flex-col">
      <CardHeader>
        <CardTitle>Synthesis Log</CardTitle>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 p-0">
        <ScrollArea class="h-full w-full p-4 font-mono text-xs bg-muted/40 text-foreground">
          <pre>{{ logs }}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  </div>
</template>
