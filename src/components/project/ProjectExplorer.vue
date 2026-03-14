<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { projectStore } from '@/stores/project'
import TreeNode from './TreeNode.vue'

const router = useRouter()
const rootNode = computed(() => projectStore.rootNode)
const visibleNodes = computed(() => rootNode.value?.children ?? projectStore.files)

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
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="flex-1 overflow-auto p-2 text-sm select-none">
          <div class="space-y-0.5">
            <template v-for="node in visibleNodes" :key="node.id">
              <TreeNode :node="node" />
            </template>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent v-if="rootNode" class="w-48">
        <ContextMenuItem @select="handleNewFile">New File</ContextMenuItem>
        <ContextMenuItem @select="handleNewFolder">New Folder</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
</template>
