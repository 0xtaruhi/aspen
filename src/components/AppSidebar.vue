<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'
import { Cpu, FolderCog, FileCode2, Zap, Bug } from 'lucide-vue-next'
import NavMain from '@/components/NavMain.vue'
import ProjectMenu from '@/components/ProjectMenu.vue'
import ProjectExplorer from '@/components/project/ProjectExplorer.vue'

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar'

const props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
})

import { uiStore } from '@/stores/ui'

const data = {
  teams: [
    {
      name: 'Aspen FPGA',
      logo: Cpu,
      plan: 'Pro',
    },
  ],
  navMain: [
    {
      title: 'Workspace',
      url: '#',
      icon: FolderCog,
      isActive: true,
      items: [
        {
          title: 'Dashboard',
          url: '#',
          action: () => uiStore.setPage('status'),
        },
        {
          title: 'Editor',
          url: '#',
          action: () => uiStore.setPage('editor'),
        },
      ],
    },
    {
      title: 'Flow Reports',
      url: '#',
      icon: FileCode2,
      items: [
        {
          title: 'Synthesis',
          url: '#',
          action: () => uiStore.setPage('synthesis'),
        },
        {
          title: 'Implementation',
          url: '#',
          action: () => uiStore.setPage('implementation'),
        },
      ],
    },
    {
      title: 'Hardware',
      url: '#',
      icon: Bug,
      items: [
        {
          title: 'Hardware Manager',
          url: '#',
          action: () => uiStore.setPage('hardware'),
        },
      ],
    },
    {
      title: 'Build Actions',
      url: '#',
      icon: Zap,
      items: [
        {
          title: 'Generate Bitstream',
          url: '#',
          action: () => uiStore.setPage('hardware'),
        },
        {
          title: 'Program Device',
          url: '#',
          action: () => uiStore.setPage('hardware'),
        },
      ],
    },
  ],
}
</script>

<template>
  <Sidebar v-bind="props" class="border-r border-sidebar-border bg-sidebar">
    <SidebarHeader>
      <ProjectMenu />
    </SidebarHeader>
    <SidebarContent>
      <!-- Mode Switcher (Optional, for now just stacked) -->

      <!-- Project Explorer Section -->
      <SidebarGroup class="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Project Sources</SidebarGroupLabel>
        <ProjectExplorer />
      </SidebarGroup>

      <!-- Main Navigation -->
      <NavMain :items="data.navMain" />
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>
