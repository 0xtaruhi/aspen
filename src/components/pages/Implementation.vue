<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const timingPaths = [
    { name: 'clk -> led[0]', slack: '0.452', levels: 4, skew: '0.012' },
    { name: 'clk -> uart_tx/state[2]', slack: '1.230', levels: 2, skew: '0.005' },
    { name: 'clk -> counter[23]', slack: '2.100', levels: 12, skew: '0.045' },
]
</script>

<template>
  <div class="p-8 space-y-8 animate-in fade-in duration-500">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Implementation</h2>
        <p class="text-muted-foreground">Place & Route results and timing analysis.</p>
      </div>
      <Badge variant="secondary">WNS: 0.452ns</Badge>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
        <Card>
            <CardHeader>
                <CardTitle>Floorplan Preview</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="aspect-video bg-zinc-900 rounded-md border border-zinc-800 relative overflow-hidden grid grid-cols-12 grid-rows-8 gap-px p-4">
                    <!-- Mock FPGA Fabric -->
                    <div v-for="i in 96" :key="i" class="bg-zinc-800/50 rounded-sm" :class="{'bg-blue-500/40': i % 7 === 0, 'bg-green-500/40': i % 13 === 0}"></div>
                </div>
            </CardContent>
        </Card>
        
        <Card>
            <CardHeader>
                <CardTitle>Power Analysis</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <span class="text-sm font-medium">Total Power</span>
                        <span class="font-bold">1.241 W</span>
                    </div>
                    <div class="h-2 bg-zinc-800 rounded-full overflow-hidden flex">
                        <div class="h-full bg-red-500 w-[60%]" title="Dynamic"></div>
                        <div class="h-full bg-blue-500 w-[40%]" title="Static"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-red-500"></div>
                            <span>Dynamic: 0.745 W</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                            <span>Static: 0.496 W</span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>

    <Card>
        <CardHeader>
            <CardTitle>Timing Summary (Top 3 Critical Paths)</CardTitle>
        </CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Path Name</TableHead>
                        <TableHead>Slack (ns)</TableHead>
                        <TableHead>Logic Levels</TableHead>
                        <TableHead>Clock Skew</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="path in timingPaths" :key="path.name">
                        <TableCell class="font-mono text-xs">{{ path.name }}</TableCell>
                        <TableCell :class="Number(path.slack) < 0 ? 'text-red-500 font-bold' : 'text-green-500'">{{ path.slack }}</TableCell>
                        <TableCell>{{ path.levels }}</TableCell>
                        <TableCell>{{ path.skew }}</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </CardContent>
    </Card>
  </div>
</template>
