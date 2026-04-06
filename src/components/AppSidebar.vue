<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'

import { Bug, Cpu, FileCode2, FolderCog, FolderOpen, FolderPlus, Plus, Plug } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import NavMain from '@/components/NavMain.vue'
import ProjectMenu from '@/components/ProjectMenu.vue'
import ProjectExplorer from '@/components/project/ProjectExplorer.vue'
import ProjectTextInputDialog from '@/components/project/ProjectTextInputDialog.vue'
import TopModuleSelect from '@/components/TopModuleSelect.vue'
import { importProjectFiles } from '@/lib/project-io'
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
import { useI18n } from '@/lib/i18n'
import { type AppRouteName, modulePathMap } from '@/router'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { requestProjectTextInput } from '@/stores/project-text-input'
import { uiStore } from '@/stores/ui'

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

function navigate(path: string) {
  void router.push(path)
}

const activeRouteName = computed(() => route.name as AppRouteName | undefined)
const rootNode = computed(() => projectStore.rootNode)
const isSynthesisRunning = hardwareStore.synthesisRunning
const isImplementationRunning = hardwareStore.implementationRunning

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
      label: t('projectManagement'),
      url: modulePathMap['project-management'],
      icon: FolderCog,
      isActive: uiStore.activeModule.value === 'project-management',
      items: [
        {
          title: 'Dashboard',
          label: t('dashboard'),
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
      label: t('fpgaFlow'),
      url: modulePathMap['fpga-flow'],
      icon: FileCode2,
      isActive: uiStore.activeModule.value === 'fpga-flow',
      isRunning: isSynthesisRunning.value || isImplementationRunning.value,
      items: [
        {
          title: 'Synthesis',
          label: t('synthesis'),
          url: '/fpga-flow/synthesis',
          action: () => navigate('/fpga-flow/synthesis'),
          isActive: activeRouteName.value === 'fpga-flow-synthesis',
          isRunning: isSynthesisRunning.value,
        },
        {
          title: 'Netlist Browser',
          label: t('netlistBrowser'),
          url: '/fpga-flow/netlist-browser',
          action: () => navigate('/fpga-flow/netlist-browser'),
          isActive: activeRouteName.value === 'fpga-flow-netlist-browser',
        },
        {
          title: 'Pin Planning',
          label: t('pinPlanning'),
          url: '/fpga-flow/pin-planning',
          action: () => navigate('/fpga-flow/pin-planning'),
          isActive: activeRouteName.value === 'fpga-flow-pin-planning',
        },
        {
          title: 'Implementation',
          label: t('implementation'),
          url: '/fpga-flow/implementation',
          action: () => navigate('/fpga-flow/implementation'),
          isActive: activeRouteName.value === 'fpga-flow-implementation',
          isRunning: isImplementationRunning.value,
        },
      ],
    },
    {
      title: 'Hardware Manager',
      label: t('hardwareManager'),
      url: modulePathMap['hardware-manager'],
      icon: Plug,
      isActive: uiStore.activeModule.value === 'hardware-manager',
      action: () => navigate(modulePathMap['hardware-manager']),
    },
    {
      title: 'Virtual Device Platform',
      label: t('virtualDevicePlatform'),
      url: modulePathMap['virtual-device-platform'],
      icon: Bug,
      isActive: uiStore.activeModule.value === 'virtual-device-platform',
      action: () => navigate(modulePathMap['virtual-device-platform']),
    },
  ],
}))

async function handleNewFile() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = await requestProjectTextInput({
    title: t('newFile'),
    confirmLabel: t('newFile'),
    initialValue: 'new_file.v',
  })
  if (!name) {
    return
  }

  projectStore.createFile(parent.id, name)
  void router.push({ name: 'project-management-editor' })
}

async function handleNewFolder() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  const name = await requestProjectTextInput({
    title: t('newFolder'),
    confirmLabel: t('newFolder'),
    initialValue: t('newFolder'),
  })
  if (!name) {
    return
  }

  projectStore.createFolder(parent.id, name)
}

function handleImportFiles() {
  void importProjectFiles()
}
</script>

<template>
  <Sidebar v-bind="props" class="border-r border-sidebar-border bg-sidebar">
    <ProjectTextInputDialog />
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
                <SidebarGroupLabel class="h-8 px-0">{{ t('projectSources') }}</SidebarGroupLabel>
                <div class="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    :title="t('newFile')"
                    :disabled="!rootNode"
                    @click="handleNewFile"
                  >
                    <Plus class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    :title="t('newFolder')"
                    :disabled="!rootNode"
                    @click="handleNewFolder"
                  >
                    <FolderPlus class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    :title="t('importFiles')"
                    :disabled="!rootNode"
                    @click="handleImportFiles"
                  >
                    <FolderOpen class="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div class="min-h-0 flex-1 overflow-hidden">
                <div v-if="rootNode" class="mx-2 mb-2">
                  <TopModuleSelect />
                </div>
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
