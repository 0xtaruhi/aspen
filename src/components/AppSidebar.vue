<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'

import { Bug, FileCode2, FolderCog, FolderOpen, FolderPlus, Plus, Plug } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import NavMain from '@/components/NavMain.vue'
import ProjectMenu from '@/components/ProjectMenu.vue'
import ProjectExplorer from '@/components/project/ProjectExplorer.vue'
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
  useSidebar,
} from '@/components/ui/sidebar'
import { useI18n } from '@/lib/i18n'
import { isMacDesktop } from '@/lib/window-frame'
import { type AppRouteName, moduleForRouteName, modulePathMap } from '@/router'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const reserveMacTrafficLights = isMacDesktop
const { state } = useSidebar()
const showMacCollapsedRail = computed(() => reserveMacTrafficLights && state.value === 'collapsed')

function navigate(path: string) {
  void router.push(path)
}

const activeRouteName = computed(() => route.name as AppRouteName | undefined)
const activeModule = computed(() => moduleForRouteName(activeRouteName.value))
const rootNode = computed(() => projectStore.rootNode)
const hasProject = computed(() => projectStore.hasProject)
const isSynthesisRunning = hardwareStore.synthesisRunning
const isImplementationRunning = hardwareStore.implementationRunning

const data = computed(() => ({
  navMain: [
    {
      title: 'Project Management',
      label: t('projectManagement'),
      url: modulePathMap['project-management'],
      icon: FolderCog,
      isActive: activeModule.value === 'project-management',
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
      isActive: activeModule.value === 'fpga-flow',
      isRunning: isSynthesisRunning.value || isImplementationRunning.value,
      disabled: !hasProject.value,
      items: [
        {
          title: 'Synthesis',
          label: t('synthesis'),
          url: '/fpga-flow/synthesis',
          action: () => navigate('/fpga-flow/synthesis'),
          isActive: activeRouteName.value === 'fpga-flow-synthesis',
          isRunning: isSynthesisRunning.value,
          disabled: !hasProject.value,
        },
        {
          title: 'Pin Planning',
          label: t('pinPlanning'),
          url: '/fpga-flow/pin-planning',
          action: () => navigate('/fpga-flow/pin-planning'),
          isActive: activeRouteName.value === 'fpga-flow-pin-planning',
          disabled: !hasProject.value,
        },
        {
          title: 'Implementation',
          label: t('implementation'),
          url: '/fpga-flow/implementation',
          action: () => navigate('/fpga-flow/implementation'),
          isActive: activeRouteName.value === 'fpga-flow-implementation',
          isRunning: isImplementationRunning.value,
          disabled: !hasProject.value,
        },
      ],
    },
    {
      title: 'Hardware Manager',
      label: t('hardwareManager'),
      url: modulePathMap['hardware-manager'],
      icon: Plug,
      isActive: activeModule.value === 'hardware-manager',
      action: () => navigate(modulePathMap['hardware-manager']),
    },
    {
      title: 'Virtual Device Platform',
      label: t('virtualDevicePlatform'),
      url: modulePathMap['virtual-device-platform'],
      icon: Bug,
      isActive: activeModule.value === 'virtual-device-platform',
      disabled: !hasProject.value,
      action: () => navigate(modulePathMap['virtual-device-platform']),
    },
  ],
}))

function handleNewFile() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  projectStore.beginCreatingFile(parent.id)
}

function handleNewFolder() {
  const parent = rootNode.value
  if (!parent) {
    return
  }

  projectStore.beginCreatingFolder(parent.id, t('newFolder'))
}

function handleImportFiles() {
  void importProjectFiles()
}
</script>

<template>
  <Sidebar v-bind="props">
    <SidebarHeader
      v-if="!showMacCollapsedRail"
      :class="[reserveMacTrafficLights ? 'app-sidebar-header-macos' : '']"
    >
      <ProjectMenu />
    </SidebarHeader>
    <SidebarContent class="overflow-hidden">
      <div v-if="showMacCollapsedRail" class="app-sidebar-collapsed-macos-stack">
        <ProjectMenu />
        <NavMain :items="data.navMain" />
      </div>
      <template v-else>
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
                    <TopModuleSelect v-if="rootNode" />
                  </div>
                </div>
                <div class="min-h-0 flex-1 overflow-hidden">
                  <ProjectExplorer />
                </div>
              </SidebarGroup>
            </ResizablePanel>

            <ResizableHandle
              class="bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[orientation=vertical]:h-2"
            />

            <ResizablePanel :default-size="54" :min-size="20">
              <ScrollArea class="h-full">
                <NavMain :items="data.navMain" />
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </template>
    </SidebarContent>
  </Sidebar>
</template>

<style scoped>
.app-sidebar-header-macos {
  padding: 2.75rem 0.5rem 0.5rem;
}

.app-sidebar-header-macos :deep([data-slot='sidebar-menu-button'][data-size='lg']) {
  padding-left: 4.5rem !important;
}

.app-sidebar-collapsed-macos-stack {
  --app-sidebar-collapsed-top-clearance: 2.75rem;
  --app-sidebar-collapsed-stack-gap: 0.5rem;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--app-sidebar-collapsed-stack-gap);
  padding: var(--app-sidebar-collapsed-top-clearance) 0.5rem 0.5rem;
}

.app-sidebar-collapsed-macos-stack :deep([data-slot='sidebar-menu-button'][data-size='lg']) {
  padding-left: 0 !important;
}

.app-sidebar-collapsed-macos-stack :deep([data-slot='sidebar-group']) {
  padding: 0;
}

.app-sidebar-collapsed-macos-stack :deep([data-slot='sidebar-group-label']) {
  display: none;
}
</style>
