<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const logs = `[Synth 8-256] done synthesizing module 'top' (1#1) [/src/top.v:1]
[Synth 8-256] done synthesizing module 'blinky' (2#1) [/src/blinky.v:1]
[Synth 8-638] synthesizing module 'uart_tx' [/src/uart_tx.v:1]
    Parameter CLK_FREQ bound to: 50000000 - type: integer 
    Parameter BAUD_RATE bound to: 115200 - type: integer 
[Synth 8-256] done synthesizing module 'uart_tx' (3#1) [/src/uart_tx.v:1]
[Common 17-83] Releasing license: Synthesis
4 Infos, 0 Warnings, 0 Critical Warnings and 0 Errors encountered.
synth_design completed successfully
synth_design: Time (s): cpu = 00:00:12 ; elapsed = 00:00:14 . Memory (MB): peak = 2345.123 ; gain = 123.456
`
</script>

<template>
  <div class="p-8 space-y-8 h-full flex flex-col animate-in fade-in duration-500">
    <div class="flex items-center justify-between shrink-0">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Synthesis</h2>
        <p class="text-muted-foreground">Logic synthesis results and reports.</p>
      </div>
      <div class="flex gap-2">
          <Badge variant="outline" class="bg-green-500/10 text-green-500 border-green-500/20">Completed</Badge>
          <span class="text-sm text-muted-foreground">Duration: 14s</span>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3 shrink-0">
        <Card>
            <CardHeader class="pb-2">
                <CardTitle class="text-sm font-medium">Logic Cells</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">1,240</div>
                <p class="text-xs text-muted-foreground">24% Utilization</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader class="pb-2">
                <CardTitle class="text-sm font-medium">Registers</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">856</div>
                <p class="text-xs text-muted-foreground">12% Utilization</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader class="pb-2">
                <CardTitle class="text-sm font-medium">Memory (BRAM)</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">4</div>
                <p class="text-xs text-muted-foreground">5% Utilization</p>
            </CardContent>
        </Card>
    </div>

    <Card class="flex-1 min-h-0 flex flex-col">
      <CardHeader>
        <CardTitle>Synthesis Log</CardTitle>
      </CardHeader>
      <CardContent class="flex-1 min-h-0 p-0">
        <ScrollArea class="h-full w-full p-4 font-mono text-xs bg-zinc-950 text-zinc-300">
            <pre>{{ logs }}</pre>
        </ScrollArea>
      </CardContent>
    </Card>
  </div>
</template>
