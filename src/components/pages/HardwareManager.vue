<script setup lang="ts">
import { ref, computed } from 'vue'
import { 
  Server, 
  Cpu, 
  RefreshCw, 
  Plug, 
  Play, 
  Terminal, 
  CheckCircle2,
  FileCode,
  Download,
  XCircle
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { Progress } from '@/components/ui/progress'

// --- Mock Data & Types ---
interface HardwareTarget {
  id: string
  name: string
  type: 'server' | 'device'
  status: 'connected' | 'disconnected' | 'programming' | 'ready'
  children?: HardwareTarget[]
  details?: Record<string, string>
}

const isConnecting = ref(false)
const isProgramming = ref(false)
const programProgress = ref(0)
const selectedTargetId = ref<string | null>(null)
const consoleLogs = ref<{ time: string, msg: string, type: 'info' | 'success' | 'error' }[]>([])

const targets = ref<HardwareTarget[]>([])

// --- Actions ---

function addLog(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  const time = new Date().toLocaleTimeString()
  consoleLogs.value.push({ time, msg, type })
  // Auto-scroll logic would go here
}

function autoConnect() {
  if (isConnecting.value) return
  
  isConnecting.value = true
  addLog('Starting Auto Connect sequence...', 'info')
  targets.value = []
  selectedTargetId.value = null

  setTimeout(() => {
    addLog('Scanning for local hardware servers...', 'info')
  }, 500)

  setTimeout(() => {
    addLog('Connected to localhost:3121', 'success')
    targets.value = [
      {
        id: 'localhost',
        name: 'localhost:3121',
        type: 'server',
        status: 'connected',
        children: [
          {
            id: 'xc7a35t_0',
            name: 'xc7a35t_0',
            type: 'device',
            status: 'ready',
            details: {
              'IDCODE': '0362D093',
              'Name': 'xc7a35t',
              'Part': 'xc7a35tcpg236',
              'Fabric Width': '1',
              'System Monitor': 'Enabled'
            }
          }
        ]
      }
    ]
    isConnecting.value = false
    // Auto-select the device
    selectedTargetId.value = 'xc7a35t_0'
    addLog('Found device: xc7a35t_0', 'success')
  }, 1500)
}

function disconnect() {
    targets.value = []
    selectedTargetId.value = null
    addLog('Disconnected from hardware server.', 'info')
}

const selectedDevice = computed(() => {
  if (!selectedTargetId.value) return null
  for (const server of targets.value) {
    if (server.children) {
      const device = server.children.find(d => d.id === selectedTargetId.value)
      if (device) return device
    }
  }
  return null
})

const bitstreamFile = ref<string>('top_design.bit')

function programDevice() {
  if (!selectedDevice.value || isProgramming.value) return
  
  isProgramming.value = true
  programProgress.value = 0
  addLog(`Programming device ${selectedDevice.value.name} with ${bitstreamFile.value}...`, 'info')
  
  const interval = setInterval(() => {
    programProgress.value += 5
    if (programProgress.value >= 100) {
      clearInterval(interval)
      isProgramming.value = false
      addLog('Device programmed successfully.', 'success')
    }
  }, 100)
}

</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <!-- Toolbar -->
    <div class="h-12 border-b flex items-center px-4 gap-2 bg-muted/20">
      <Button 
        variant="outline" 
        size="sm" 
        class="gap-2"
        :disabled="isConnecting || targets.length > 0"
        @click="autoConnect"
      >
        <Plug class="w-4 h-4" />
        {{ isConnecting ? 'Connecting...' : 'Auto Connect' }}
      </Button>
      
       <Button 
        v-if="targets.length > 0"
        variant="ghost" 
        size="sm" 
        class="gap-2 text-destructive hover:text-destructive"
        @click="disconnect"
      >
        <XCircle class="w-4 h-4" />
        Disconnect
      </Button>

      <Separator orientation="vertical" class="h-6 mx-2" />

      <Button variant="ghost" size="icon" title="Refresh Targets">
        <RefreshCw class="w-4 h-4" />
      </Button>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="vertical">
            <ResizablePanel :default-size="70">
                 <ResizablePanelGroup direction="horizontal">
                    <!-- Hardware Tree -->
                    <ResizablePanel :default-size="25" :min-size="20" class="border-r bg-muted/10">
                        <div class="p-2 font-medium text-xs text-muted-foreground uppercase tracking-wider mb-2">Hardware Targets</div>
                        <ScrollArea class="h-full">
                            <div v-if="targets.length === 0" class="p-4 text-sm text-muted-foreground text-center italic">
                                No hardware targets open. <br> Click "Auto Connect" to start.
                            </div>
                            <div v-else class="px-2 space-y-1">
                                <div v-for="server in targets" :key="server.id">
                                    <div class="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer text-sm font-medium">
                                        <Server class="w-4 h-4 text-blue-500" />
                                        {{ server.name }}
                                        <Badge variant="outline" class="ml-auto text-[10px] h-5">Connected</Badge>
                                    </div>
                                    <div class="ml-4 border-l pl-2 mt-1 space-y-1">
                                        <div 
                                            v-for="device in server.children" 
                                            :key="device.id"
                                            class="flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors"
                                            :class="selectedTargetId === device.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'"
                                            @click="selectedTargetId = device.id"
                                        >
                                            <Cpu class="w-4 h-4" :class="selectedTargetId === device.id ? 'text-primary' : 'text-orange-500'" />
                                            {{ device.name }}
                                            <span v-if="selectedTargetId === device.id" class="ml-auto w-2 h-2 rounded-full bg-green-500"></span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                    </ResizablePanel>
                    
                    <ResizableHandle />

                    <!-- Device Details & Operations -->
                    <ResizablePanel :default-size="75" class="bg-background p-6">
                        <div v-if="selectedDevice" class="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            
                            <!-- Header -->
                            <div class="flex items-start justify-between">
                                <div>
                                    <h2 class="text-2xl font-bold flex items-center gap-2">
                                        <Cpu class="w-6 h-6 text-primary" />
                                        {{ selectedDevice.name }}
                                    </h2>
                                    <p class="text-muted-foreground mt-1">Xilinx Artix-7 FPGA (xc7a35t)</p>
                                </div>
                                <Badge variant="secondary" class="text-green-600 bg-green-500/10 border-green-200">
                                    <CheckCircle2 class="w-3 h-3 mr-1" />
                                    Active
                                </Badge>
                            </div>

                            <!-- Device Properties Grid -->
                            <div class="grid grid-cols-2 gap-4">
                                <Card v-for="(value, key) in selectedDevice.details" :key="key">
                                    <CardHeader class="pb-2">
                                        <CardTitle class="text-xs font-medium text-muted-foreground uppercase">{{ key }}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div class="text-lg font-mono">{{ value }}</div>
                                    </CardContent>
                                </Card>
                            </div>

                            <Separator />

                            <!-- Programming Section -->
                            <div class="space-y-4">
                                <h3 class="text-lg font-semibold flex items-center gap-2">
                                    <Download class="w-5 h-5" />
                                    Program Device
                                </h3>
                                
                                <div class="flex gap-4 items-end">
                                    <div class="grid w-full max-w-sm items-center gap-1.5">
                                        <label for="bitstream" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Bitstream File</label>
                                        <div class="flex w-full items-center space-x-2">
                                            <div class="relative flex-1">
                                                <FileCode class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                                <input 
                                                    id="bitstream"
                                                    type="text" 
                                                    v-model="bitstreamFile"
                                                    class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-9 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" 
                                                />
                                            </div>
                                            <Button variant="secondary">Browse...</Button>
                                        </div>
                                    </div>
                                    <Button class="w-32" :disabled="isProgramming" @click="programDevice">
                                        <Play v-if="!isProgramming" class="w-4 h-4 mr-2" />
                                        {{ isProgramming ? 'Programming...' : 'Program' }}
                                    </Button>
                                </div>

                                <div v-if="isProgramming || programProgress > 0" class="space-y-2">
                                    <div class="flex justify-between text-xs text-muted-foreground">
                                        <span>Status: {{ isProgramming ? 'Writing bitstream...' : 'Done' }}</span>
                                        <span>{{ programProgress }}%</span>
                                    </div>
                                    <Progress :model-value="programProgress" class="h-2" />
                                </div>
                            </div>

                        </div>
                        <div v-else class="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                            <div class="p-4 bg-muted/30 rounded-full">
                                <Cpu class="w-12 h-12 opacity-50" />
                            </div>
                            <p>Select a hardware device to view details and program.</p>
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </ResizablePanel>
            
            <ResizableHandle />

            <!-- Console Panel -->
            <ResizablePanel :default-size="30" :min-size="10" class="bg-black text-green-400 font-mono text-xs flex flex-col">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-white/5">
                    <Terminal class="w-3 h-3" />
                    <span class="font-bold">Tcl Console / Hardware Log</span>
                </div>
                <ScrollArea class="flex-1 p-4">
                    <div v-for="(log, i) in consoleLogs" :key="i" class="mb-1">
                        <span class="opacity-50">[{{ log.time }}]</span> 
                        <span :class="{
                            'text-green-400': log.type === 'info',
                            'text-blue-400': log.type === 'success',
                            'text-red-400': log.type === 'error'
                        }" class="ml-2">{{ log.msg }}</span>
                    </div>
                    <div class="mt-2 animate-pulse">_</div>
                </ScrollArea>
            </ResizablePanel>
        </ResizablePanelGroup>
    </div>
  </div>
</template>
