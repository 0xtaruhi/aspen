<script setup lang="ts">
import { ref } from "vue"
import { ChevronsUpDown, Plus, FolderOpen, Save, Box } from "lucide-vue-next"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import NewProjectDialog from './project/NewProjectDialog.vue'

const { isMobile } = useSidebar()
const activeProject = ref({ name: "Aspen FPGA", plan: "Pro" })
const showNewProjectDialog = ref(false)

</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Box class="size-4" />
            </div>
            <div class="grid flex-1 text-left text-sm leading-tight">
              <span class="truncate font-medium">
                {{ activeProject.name }}
              </span>
              <span class="truncate text-xs">{{ activeProject.plan }}</span>
            </div>
            <ChevronsUpDown class="ml-auto" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          class="w-[--reka-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          align="start"
          :side="isMobile ? 'bottom' : 'right'"
          :side-offset="4"
        >
          <DropdownMenuLabel class="text-xs text-muted-foreground">
            Project Actions
          </DropdownMenuLabel>
          
          <DropdownMenuItem class="gap-2 p-2" @click="showNewProjectDialog = true">
            <div class="flex size-6 items-center justify-center rounded-sm border">
               <Plus class="size-4" />
            </div>
            New Project
          </DropdownMenuItem>
          
          <DropdownMenuItem class="gap-2 p-2">
            <div class="flex size-6 items-center justify-center rounded-sm border">
               <FolderOpen class="size-4" />
            </div>
            Open Project
          </DropdownMenuItem>
          
          <DropdownMenuItem class="gap-2 p-2">
            <div class="flex size-6 items-center justify-center rounded-sm border">
               <Save class="size-4" />
            </div>
            Save Project
          </DropdownMenuItem>
          
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
