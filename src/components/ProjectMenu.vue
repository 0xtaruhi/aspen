<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronsUpDown, Plus, FolderOpen, Save, Box, Settings2 } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useI18n } from '@/lib/i18n'
import { openProject, saveProject, saveProjectAs } from '@/lib/project-io'
import NewProjectDialog from './project/NewProjectDialog.vue'
import { projectStore } from '@/stores/project'

const { isMobile } = useSidebar()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
const router = useRouter()
const activeProject = computed(() => ({
  name: `${projectStore.files[0]?.name || 'Aspen FPGA'}${projectStore.hasUnsavedChanges ? ' *' : ''}`,
  plan: t('projectManagement'),
}))

function openSettings() {
  void router.push({ name: 'settings' })
}
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
            <div
              class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
            >
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
            {{ t('projectActions') }}
          </DropdownMenuLabel>

          <DropdownMenuItem class="gap-2 p-2" @click="showNewProjectDialog = true">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Plus class="size-4" />
            </div>
            {{ t('newProject') }}
          </DropdownMenuItem>

          <DropdownMenuItem class="gap-2 p-2" @click="openProject">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <FolderOpen class="size-4" />
            </div>
            {{ t('openProject') }}
          </DropdownMenuItem>

          <DropdownMenuItem class="gap-2 p-2" @click="saveProject">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Save class="size-4" />
            </div>
            {{ t('saveProject') }}
            <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuItem class="gap-2 p-2" @click="saveProjectAs">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Save class="size-4" />
            </div>
            {{ t('saveProjectAs') }}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem class="gap-2 p-2" @click="openSettings">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Settings2 class="size-4" />
            </div>
            {{ t('settings') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
