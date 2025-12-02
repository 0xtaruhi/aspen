<script setup lang="ts">
import { projectStore } from '@/stores/project'
import TreeNode from './TreeNode.vue'
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <!-- Header Actions (Removed as per request, moved to main menu or context menu) -->
    <!-- Keeping a minimal header or just the tree -->
    
    <!-- File List -->
    <div class="flex-1 overflow-auto p-2 text-sm select-none">
        <div class="space-y-0.5">
            <template v-for="node in projectStore.files" :key="node.id">
                <TreeNode :node="node" />
            </template>
        </div>
    </div>
  </div>
</template>
