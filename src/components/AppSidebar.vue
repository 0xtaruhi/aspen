<script setup lang="ts">
import type { SidebarProps } from '@/components/ui/sidebar'
import {
  Cpu,
  FolderCog,
  FileCode2,
  FlaskConical,
  Zap,
  Bug,
} from "lucide-vue-next"
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
  collapsible: "icon",
})

import { uiStore } from '@/stores/ui'

// This is sample data.
const data = {
  teams: [
    {
      name: "Aspen FPGA",
      logo: Cpu,
      plan: "Pro",
    },
  ],
  navMain: [
    {
      title: "Project Manager",
      url: "#",
      icon: FolderCog,
      isActive: true,
      items: [
        {
          title: "Dashboard",
          url: "#",
          action: () => uiStore.setPage('status'),
        },
        {
          title: "Settings",
          url: "#",
        },
        {
          title: "IP Catalog",
          url: "#",
        }
      ],
    },
    {
      title: "RTL Analysis",
      url: "#",
      icon: FileCode2,
      items: [
        {
          title: "Elaborated Design",
          url: "#",
          action: () => uiStore.setPage('editor'),
        },
        {
          title: "IO Planning",
          url: "#",
        }
      ],
    },
    {
      title: "Simulation",
      url: "#",
      icon: FlaskConical,
      items: [
        {
          title: "Run Behavioral",
          url: "#",
        },
      ],
    },
    {
      title: "Synthesis",
      url: "#",
      icon: Zap,
      items: [
        {
          title: "Run Synthesis",
          url: "#",
        },
        {
          title: "View Reports",
          url: "#",
          action: () => uiStore.setPage('synthesis'),
        }
      ],
    },
    {
      title: "Implementation",
      url: "#",
      icon: Cpu,
      items: [
        {
          title: "Run Implementation",
          url: "#",
        },
        {
          title: "View Reports",
          url: "#",
          action: () => uiStore.setPage('implementation'),
        }
      ],
    },
    {
      title: "Program and Debug",
      url: "#",
      icon: Bug,
      items: [
        {
          title: "Generate Bitstream",
          url: "#",
        },
        {
          title: "Hardware Manager",
          url: "#",
          action: () => uiStore.setPage('hardware'),
        }
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
