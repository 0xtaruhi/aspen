<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'
import { ChevronRight, LoaderCircle } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { useI18n } from '@/lib/i18n'

defineProps<{
  items: {
    title: string
    label?: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    isRunning?: boolean
    action?: () => void
    items?: {
      title: string
      label?: string
      url: string
      action?: () => void
      isActive?: boolean
      isRunning?: boolean
    }[]
  }[]
}>()

const { t } = useI18n()
</script>

<template>
  <SidebarGroup>
    <SidebarGroupLabel>{{ t('platform') }}</SidebarGroupLabel>
    <SidebarMenu>
      <template v-for="item in items" :key="item.title">
        <SidebarMenuItem>
          <template v-if="item.items?.length">
            <Collapsible as-child :default-open="item.isActive" class="group/collapsible">
              <div>
                <CollapsibleTrigger as-child>
                  <SidebarMenuButton :tooltip="item.label ?? item.title" :is-active="item.isActive">
                    <component :is="item.icon" v-if="item.icon" />
                    <span>{{ item.label ?? item.title }}</span>
                    <LoaderCircle
                      v-if="item.isRunning"
                      class="ml-auto size-4 animate-spin text-sidebar-foreground/70"
                    />
                    <ChevronRight
                      :class="[
                        'transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90',
                        item.isRunning ? '' : 'ml-auto',
                      ]"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem v-for="subItem in item.items" :key="subItem.title">
                      <SidebarMenuSubButton
                        type="button"
                        :is-active="subItem.isActive"
                        @click="subItem.action ? subItem.action() : null"
                      >
                        <span>{{ subItem.label ?? subItem.title }}</span>
                        <LoaderCircle
                          v-if="subItem.isRunning"
                          class="ml-auto size-4 animate-spin text-sidebar-foreground/70"
                        />
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </template>
          <template v-else>
            <SidebarMenuButton
              type="button"
              :tooltip="item.label ?? item.title"
              :is-active="item.isActive"
              @click="item.action ? item.action() : null"
            >
              <component :is="item.icon" v-if="item.icon" />
              <span>{{ item.label ?? item.title }}</span>
              <LoaderCircle
                v-if="item.isRunning"
                class="ml-auto size-4 animate-spin text-sidebar-foreground/70"
              />
            </SidebarMenuButton>
          </template>
        </SidebarMenuItem>
      </template>
    </SidebarMenu>
  </SidebarGroup>
</template>
