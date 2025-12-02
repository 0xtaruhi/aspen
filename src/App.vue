<script lang="ts">
export const description
  = "A sidebar that collapses to icons."
export const iframeHeight = "800px"
export const containerClass = "w-full h-full"
</script>

<script setup lang="ts">
import AppSidebar from "@/components/AppSidebar.vue"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import DeviceCanvas from "./components/canvas/DeviceCanvas.vue"
import CodeEditor from "./components/editor/CodeEditor.vue"
import { ref } from 'vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import { LayoutGrid, Code, Monitor } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"

import { projectStore } from '@/stores/project'
import { uiStore } from '@/stores/ui'
import ThemeToggleButton from '@/components/ThemeToggleButton.vue'
import ProjectStatus from '@/components/pages/ProjectStatus.vue'
import Synthesis from '@/components/pages/Synthesis.vue'
import Implementation from '@/components/pages/Implementation.vue'
import HardwareManager from '@/components/pages/HardwareManager.vue'

const showGallery = ref(false)
function toggleGallery() { showGallery.value = !showGallery.value }

const viewMode = ref<'split' | 'code' | 'canvas'>('split')

</script>

<template>
  <div class="min-h-screen bg-background text-foreground transition-colors">
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset class="relative h-screen overflow-hidden flex flex-col">
        <header
          class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b border-border bg-background/50 backdrop-blur z-10">
          <div class="flex items-center gap-2 px-4 w-full">
            <SidebarTrigger class="-ml-1" />
            <Separator orientation="vertical" class="mr-2 h-4" />
            
            <!-- View Toggles -->
            <div class="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border">
                <button 
                    class="p-1.5 rounded-md transition-colors hover:bg-background hover:text-foreground"
                    :class="viewMode === 'code' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="viewMode = 'code'"
                    title="Code Only"
                >
                    <Code class="w-4 h-4" />
                </button>
                 <button 
                    class="p-1.5 rounded-md transition-colors hover:bg-background hover:text-foreground"
                    :class="viewMode === 'split' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="viewMode = 'split'"
                    title="Split View"
                >
                    <div class="flex gap-0.5">
                        <div class="w-1.5 h-3 bg-current rounded-[1px]"></div>
                        <div class="w-1.5 h-3 bg-current rounded-[1px]"></div>
                    </div>
                </button>
                 <button 
                    class="p-1.5 rounded-md transition-colors hover:bg-background hover:text-foreground"
                    :class="viewMode === 'canvas' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="viewMode = 'canvas'"
                    title="Canvas Only"
                >
                    <Monitor class="w-4 h-4" />
                </button>
            </div>

            <Separator orientation="vertical" class="mx-2 h-4" />

            <Tooltip v-if="viewMode !== 'code'">
              <TooltipTrigger as-child>
                <button class="h-7 w-7 grid place-items-center rounded-md bg-card hover:bg-muted transition border border-border"
                  type="button" @click="toggleGallery" aria-label="Open Gallery">
                  <LayoutGrid class="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">Component Gallery</TooltipContent>
            </Tooltip>
            
            <div class="ml-auto flex items-center gap-2">
                 <ThemeToggleButton />
                 <Separator orientation="vertical" class="h-4" />
                 <Breadcrumb>
                <BreadcrumbList>
                    <BreadcrumbItem class="hidden md:block">
                    <BreadcrumbLink href="#">
                        Project
                    </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator class="hidden md:block" />
                    <BreadcrumbItem>
                    <BreadcrumbPage>TopDesign.v</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
                </Breadcrumb>
            </div>
          </div>
        </header>
        
        <div class="flex-1 overflow-hidden relative">
            <ComponentGallery :open="showGallery" />
            
            <!-- Editor & Canvas View -->
            <ResizablePanelGroup 
                v-if="uiStore.activePage.value === 'editor'" 
                direction="horizontal" 
                class="h-full w-full"
            >
                <!-- Code Editor Panel -->
                <ResizablePanel 
                    v-if="viewMode !== 'canvas'" 
                    :default-size="50" 
                    :min-size="20" 
                    class="bg-card border-r border-border"
                >
                    <CodeEditor 
                        :value="projectStore.code" 
                        @update:value="projectStore.updateCode($event)" 
                    />
                </ResizablePanel>

                <ResizableHandle v-if="viewMode === 'split'" with-handle />

                <!-- Canvas Panel -->
                <ResizablePanel 
                    v-if="viewMode !== 'code'" 
                    :default-size="50" 
                    :min-size="20"
                >
                    <DeviceCanvas />
                </ResizablePanel>
            </ResizablePanelGroup>

            <!-- Dashboard Pages -->
            <div v-else class="h-full w-full overflow-auto bg-background">
                <ProjectStatus v-if="uiStore.activePage.value === 'status'" />
                <Synthesis v-if="uiStore.activePage.value === 'synthesis'" />
                <Implementation v-if="uiStore.activePage.value === 'implementation'" />
                <HardwareManager v-if="uiStore.activePage.value === 'hardware'" />
            </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>
