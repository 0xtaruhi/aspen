<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronsUpDown, Plus, FolderOpen, FolderX, Save, Box, Settings2 } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useI18n } from '@/lib/i18n'
import {
  closeProject,
  openProject,
  openRecentProject,
  saveProject,
  saveProjectAs,
} from '@/lib/project-io'
import NewProjectDialog from './project/NewProjectDialog.vue'
import { projectStore } from '@/stores/project'
import { recentProjectsStore } from '@/stores/recent-projects'

const { isMobile } = useSidebar()
const { t } = useI18n()
const showNewProjectDialog = ref(false)
const router = useRouter()
const activeProject = computed(() =>
  projectStore.hasProject
    ? `${projectStore.files[0]?.name || 'Aspen FPGA'}${projectStore.hasUnsavedChanges ? ' *' : ''}`
    : t('noProjectOpen'),
)
const recentProjects = computed(() => recentProjectsStore.state.entries)

function openSettings() {
  void router.push({ name: 'settings' })
}

function handleOpenRecentProject(path: string) {
  void openRecentProject(path)
}

async function handleCloseProject() {
  if (await closeProject()) {
    void router.push({ name: 'project-management-dashboard' })
  }
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
            class="data-[state=open]:bg-sidebar-accent/82 data-[state=open]:text-sidebar-accent-foreground"
          >
            <div data-sidebar-slot="icon" class="text-sidebar-primary-foreground">
              <div
                class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary"
              >
                <Box class="size-4" />
              </div>
            </div>
            <div data-sidebar-slot="label" class="grid text-left text-sm leading-tight">
              <span class="truncate font-medium">
                {{ activeProject }}
              </span>
            </div>
            <div data-sidebar-slot="trailing">
              <ChevronsUpDown class="size-4" />
            </div>
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

          <DropdownMenuSub>
            <DropdownMenuSubTrigger class="gap-2 p-2">
              <div class="flex size-6 items-center justify-center rounded-sm border">
                <FolderOpen class="size-4" />
              </div>
              {{ t('openRecent') }}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-72 rounded-lg">
              <DropdownMenuLabel class="text-xs text-muted-foreground">
                {{ t('recentProjects') }}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                v-if="recentProjects.length === 0"
                disabled
                class="p-2 text-muted-foreground"
              >
                {{ t('noRecentProjects') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-for="entry in recentProjects"
                v-else
                :key="entry.path"
                class="flex flex-col items-start gap-1 p-2"
                @click="handleOpenRecentProject(entry.path)"
              >
                <span class="max-w-full truncate text-sm font-medium">{{ entry.name }}</span>
                <span class="max-w-full truncate text-xs text-muted-foreground">
                  {{ entry.path }}
                </span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            class="gap-2 p-2"
            :disabled="!projectStore.hasProject"
            @click="saveProject"
          >
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Save class="size-4" />
            </div>
            {{ t('saveProject') }}
            <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuItem
            class="gap-2 p-2"
            :disabled="!projectStore.hasProject"
            @click="saveProjectAs"
          >
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Save class="size-4" />
            </div>
            {{ t('saveProjectAs') }}
          </DropdownMenuItem>

          <DropdownMenuItem
            class="gap-2 p-2"
            :disabled="!projectStore.hasProject"
            @click="handleCloseProject"
          >
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <FolderX class="size-4" />
            </div>
            {{ t('closeProject') }}
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
