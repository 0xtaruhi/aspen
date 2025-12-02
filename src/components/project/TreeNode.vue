<script setup lang="ts">
import { Folder, FileCode, ChevronRight, ChevronDown, Plus, FolderPlus, Trash2, Edit2 } from 'lucide-vue-next'
import { projectStore, type ProjectNode } from '@/stores/project'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator } from '@/components/ui/context-menu'

const props = defineProps<{
    node: ProjectNode
}>()

function toggleFolder() {
    if (props.node.type === 'folder') {
        props.node.isOpen = !props.node.isOpen
    }
}

function handleRename() {
    const newName = prompt("Enter new name:", props.node.name)
    if (newName) {
        projectStore.renameNode(props.node.id, newName)
    }
}

function handleNewFile() {
    const name = prompt("Enter file name:", "new_file.v")
    if (name) {
        projectStore.createFile(props.node.id, name)
    }
}

function handleNewFolder() {
    const name = prompt("Enter folder name:", "New Folder")
    if (name) {
        projectStore.createFolder(props.node.id, name)
    }
}

function handleDelete() {
    if (confirm(`Are you sure you want to delete ${props.node.name}?`)) {
        projectStore.deleteNode(props.node.id)
    }
}
</script>

<template>
    <div class="pl-2">
        <ContextMenu>
            <ContextMenuTrigger>
                <div 
                    class="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                    :class="{'bg-accent text-accent-foreground': projectStore.activeFileId === node.id}"
                    @click="node.type === 'folder' ? toggleFolder() : projectStore.setActiveFile(node.id)"
                >
                    <component 
                        :is="node.type === 'folder' ? (node.isOpen ? ChevronDown : ChevronRight) : FileCode" 
                        class="w-4 h-4 text-muted-foreground"
                        :class="{'invisible': node.type === 'file'}"
                    />
                    <component 
                        :is="node.type === 'folder' ? Folder : FileCode" 
                        class="w-4 h-4"
                        :class="node.type === 'folder' ? 'text-blue-400' : 'text-zinc-400'"
                    />
                    <span>{{ node.name }}</span>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
                <ContextMenuItem @select="handleRename">
                    <Edit2 class="w-4 h-4 mr-2" /> Rename
                </ContextMenuItem>
                <ContextMenuItem @select="handleDelete" class="text-destructive">
                    <Trash2 class="w-4 h-4 mr-2" /> Delete
                </ContextMenuItem>
                <template v-if="node.type === 'folder'">
                    <ContextMenuSeparator />
                    <ContextMenuItem @select="handleNewFile">
                        <Plus class="w-4 h-4 mr-2" /> New File
                    </ContextMenuItem>
                    <ContextMenuItem @select="handleNewFolder">
                        <FolderPlus class="w-4 h-4 mr-2" /> New Folder
                    </ContextMenuItem>
                </template>
            </ContextMenuContent>
        </ContextMenu>
        
        <div v-if="node.type === 'folder' && node.isOpen" class="ml-2 border-l border-border/50">
            <TreeNode 
                v-for="child in node.children" 
                :key="child.id" 
                :node="child" 
            />
        </div>
    </div>
</template>
