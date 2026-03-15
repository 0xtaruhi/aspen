<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'

import {
  Bug,
  Cpu,
  Edit2,
  FileCode2,
  FolderCog,
  FolderPlus,
  Plus,
  Plug,
  Trash2,
} from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import NavMain from '@/components/NavMain.vue'
import ProjectMenu from '@/components/ProjectMenu.vue'
import ProjectExplorer from '@/components/project/ProjectExplorer.vue'
import { confirmAction } from '@/lib/confirm-action'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { type AppRouteName, modulePathMap } from '@/router'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { settingsStore } from '@/stores/settings'
import { uiStore } from '@/stores/ui'

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

const route = useRoute()
const router = useRouter()

function navigate(path: string) {
  void router.push(path)
}

const activeRouteName = computed(() => route.name as AppRouteName | undefined)
const rootNode = computed(() => projectStore.rootNode)
const activeSourceNode = computed(() => projectStore.activeFile)
const isSynthesisRunning = hardwareStore.synthesisRunning

const data = computed(() => ({
  teams: [
    {
      name: 'Aspen FPGA',
      logo: Cpu,
      plan: 'Pro',
    },
  ],
  navMain: [
    {
      title: 'Project Management',
      url: modulePathMap['project-management'],
      icon: FolderCog,
      isActive: uiStore.activeModule.value === 'project-management',
      items: [
        {
          title: 'Dashboard',
          url: '/project-management/dashboard',
          action: () => navigate('/project-management/dashboard'),
          isActive:
            activeRouteName.value === 'project-management-dashboard' ||
            activeRouteName.value === 'project-management',
        },
      ],
    },
    {
      title: 'FPGA Flow',
      url: modulePathMap['fpga-flow'],
      icon: FileCode2,
      isActive: uiStore.activeModule.value === 'fpga-flow',
      isRunning: isSynthesisRunning.value,
      items: [
        {
          title: 'Synthesis',
          url: '/fpga-flow/synthesis',
          action: () => navigate('/fpga-flow/synthesis'),
          isActive: activeRouteName.value === 'fpga-flow-synthesis',
          isRunning: isSynthesisRunning.value,
        },
        {
          title: 'Implementation',
          url: '/fpga-flow/implementation',
          action: () => navigate('/fpga-flow/implementation'),
          isActive: activeRouteName.value === 'fpga-flow-implementation',
        },
      ],
    },
    {
      title: 'Hardware Manager',
      url: modulePathMap['hardware-manager'],
      icon: Plug,
      isActive: uiStore.activeModule.value === 'hardware-manager',
      action: () => navigate(modulePathMap['hardware-manager']),
    },
    {
      title: 'Virtual Device Platform',
      url: modulePathMap['virtual-device-platform'],
      icon: Bug,
      isActive: uiStore.activeModule.value === 'virtual-device-platform',
      items: [
        {
          title: 'Workbench',
          url: modulePathMap['virtual-device-platform'],
          action: () => navigate(modulePathMap['virtual-device-platform']),
          isActive: activeRouteName.value === 'virtual-device-platform',
        },
      ],
    },
  ],
}))

function handleNewFile() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = prompt('Enter file name:', 'new_file.v')
  if (name) {
    projectStore.createFile(parent.id, name)
    void router.push({ name: 'project-management-editor' })
  }
}

function handleNewFolder() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = prompt('Enter folder name:', 'New Folder')
  if (name) {
    projectStore.createFolder(parent.id, name)
  }
}

function handleRenameActiveSource() {
  const node = activeSourceNode.value
  if (!node) {
    return
  }

  const newName = prompt('Enter new name:', node.name)
  if (newName) {
    projectStore.renameNode(node.id, newName)
  }
}

async function handleDeleteActiveSource() {
  const node = activeSourceNode.value
  if (!node) {
    return
  }

  if (
    !settingsStore.state.confirmDelete ||
    (await confirmAction(`Are you sure you want to delete ${node.name}?`, {
      title: 'Delete File',
    }))
  ) {
    projectStore.deleteNode(node.id)
  }
}
</script>

<template>
  <Sidebar v-bind="props" class="border-r border-sidebar-border bg-sidebar">
    <SidebarHeader>
      <ProjectMenu />
    </SidebarHeader>
    <SidebarContent class="overflow-hidden">
      <div class="hidden min-h-0 flex-1 flex-col group-data-[collapsible=icon]:flex">
        <NavMain :items="data.navMain" />
      </div>

      <div class="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
        <ResizablePanelGroup direction="vertical" class="h-full">
          <ResizablePanel :default-size="46" :min-size="18">
            <SidebarGroup class="h-full min-h-0 gap-2">
              <div class="flex items-center gap-1 px-2">
                <SidebarGroupLabel class="h-8 px-0">Project Sources</SidebarGroupLabel>
                <div class="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    title="New file"
                    @click="handleNewFile"
                  >
                    <Plus class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    title="New folder"
                    @click="handleNewFolder"
                  >
                    <FolderPlus class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    title="Rename selected file"
                    :disabled="!activeSourceNode"
                    @click="handleRenameActiveSource"
                  >
                    <Edit2 class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    title="Delete selected file"
                    :disabled="!activeSourceNode"
                    @click="handleDeleteActiveSource"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div class="min-h-0 flex-1 overflow-hidden">
                <ProjectExplorer />
              </div>
            </SidebarGroup>
          </ResizablePanel>

          <ResizableHandle with-handle />

          <ResizablePanel :default-size="54" :min-size="20">
            <ScrollArea class="h-full">
              <NavMain :items="data.navMain" />
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>
