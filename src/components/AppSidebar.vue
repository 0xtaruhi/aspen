<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'

import { Cpu, Bug, FileCode2, FolderCog } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import NavMain from '@/components/NavMain.vue'
import ProjectMenu from '@/components/ProjectMenu.vue'
import ProjectExplorer from '@/components/project/ProjectExplorer.vue'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { type AppRouteName, modulePathMap } from '@/router'
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
      items: [
        {
          title: 'Synthesis',
          url: '/fpga-flow/synthesis',
          action: () => navigate('/fpga-flow/synthesis'),
          isActive: activeRouteName.value === 'fpga-flow-synthesis',
        },
        {
          title: 'Implementation',
          url: '/fpga-flow/implementation',
          action: () => navigate('/fpga-flow/implementation'),
          isActive: activeRouteName.value === 'fpga-flow-implementation',
        },
        {
          title: 'Hardware Manager',
          url: '/fpga-flow/hardware',
          action: () => navigate('/fpga-flow/hardware'),
          isActive: activeRouteName.value === 'fpga-flow-hardware',
        },
      ],
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
</script>

<template>
  <Sidebar v-bind="props" class="border-r border-sidebar-border bg-sidebar">
    <SidebarHeader>
      <ProjectMenu />
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup class="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Project Sources</SidebarGroupLabel>
        <ProjectExplorer />
      </SidebarGroup>

      <NavMain :items="data.navMain" />
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>
