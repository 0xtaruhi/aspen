<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { ChevronsUpDown, Plus, FolderOpen, Save, Box } from 'lucide-vue-next'
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
import { projectStore } from '@/stores/project'

const { isMobile } = useSidebar()
const showNewProjectDialog = ref(false)
const activeProject = computed(() => ({
  name: projectStore.files[0]?.name || 'Aspen FPGA',
  plan: 'Pro',
}))

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isTauriUnavailable(err: unknown): boolean {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

async function openProjectInBrowserFallback() {
  if (typeof document === 'undefined') {
    return
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown
      projectStore.loadFromSnapshot(data)
    } catch (err) {
      window.alert(`Failed to open project: ${getErrorMessage(err)}`)
    }
  }

  input.click()
}

function saveProjectInBrowserFallback(serialized: string, filename: string) {
  if (typeof document === 'undefined') {
    return
  }

  const blob = new Blob([serialized], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function openProject() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Aspen Project', extensions: ['json'] }],
    })

    if (typeof selected !== 'string') {
      return
    }

    const content = await invoke<string>('read_project_file', { path: selected })
    const data = JSON.parse(content) as unknown
    projectStore.loadFromSnapshot(data)
  } catch (err) {
    if (isTauriUnavailable(err)) {
      await openProjectInBrowserFallback()
      return
    }
    window.alert(`Failed to open project: ${getErrorMessage(err)}`)
  }
}

async function saveProject() {
  const snapshot = projectStore.toSnapshot()
  const serialized = JSON.stringify(snapshot, null, 2)
  const filename = `${snapshot.name || 'project'}.aspen.json`

  try {
    const selected = await saveDialog({
      defaultPath: filename,
      filters: [{ name: 'Aspen Project', extensions: ['json'] }],
    })

    if (!selected || Array.isArray(selected)) {
      return
    }

    await invoke('write_project_file', { path: selected, content: serialized })
  } catch (err) {
    if (isTauriUnavailable(err)) {
      saveProjectInBrowserFallback(serialized, filename)
      return
    }
    window.alert(`Failed to save project: ${getErrorMessage(err)}`)
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
            Project Actions
          </DropdownMenuLabel>

          <DropdownMenuItem class="gap-2 p-2" @click="showNewProjectDialog = true">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <Plus class="size-4" />
            </div>
            New Project
          </DropdownMenuItem>

          <DropdownMenuItem class="gap-2 p-2" @click="openProject">
            <div class="flex size-6 items-center justify-center rounded-sm border">
              <FolderOpen class="size-4" />
            </div>
            Open Project
          </DropdownMenuItem>

          <DropdownMenuItem class="gap-2 p-2" @click="saveProject">
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
