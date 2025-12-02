import { reactive } from 'vue'
import { parseVerilogPorts, type VerilogPort } from '@/lib/verilog-parser'

export type ProjectNode = {
    id: string
    name: string
    type: 'file' | 'folder'
    content?: string // Only for files
    children?: ProjectNode[] // Only for folders
    isOpen?: boolean // For UI state
}

export const projectStore = reactive({
    files: [
        {
            id: 'root',
            name: 'src',
            type: 'folder',
            isOpen: true,
            children: [
                {
                    id: '1',
                    name: 'top_module.v',
                    type: 'file',
                    content: `module top_module(
    input clk,
    input [7:0] sw,
    output [7:0] led
);

    assign led = sw;

endmodule`
                },
                {
                    id: '2',
                    name: 'counter.v',
                    type: 'file',
                    content: `module counter(
    input clk,
    input rst,
    output reg [7:0] count
);

    always @(posedge clk) begin
        if (rst) count <= 0;
        else count <= count + 1;
    end

endmodule`
                }
            ]
        }
    ] as ProjectNode[],
    
    activeFileId: '1',
    
    // Helper to find a node by ID recursively
    findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null {
        const searchNodes = nodes || this.files
        for (const node of searchNodes) {
            if (node.id === id) return node
            if (node.children) {
                const found = this.findNode(id, node.children)
                if (found) return found
            }
        }
        return null
    },

    get activeFile() {
        return this.findNode(this.activeFileId)
    },

    get code() {
        return this.activeFile?.content || ''
    },

    get signals() {
        if (this.activeFile?.name.endsWith('.v')) {
            return parseVerilogPorts(this.activeFile.content || '')
        }
        return [] as VerilogPort[]
    },
    
    updateCode(newCode: string) {
        const file = this.activeFile
        if (file && file.type === 'file') {
            file.content = newCode
        }
    },

    setActiveFile(id: string) {
        this.activeFileId = id
    },

    // File Operations
    createFile(parentId: string, name: string) {
        const parent = this.findNode(parentId)
        if (parent && parent.type === 'folder') {
            if (!parent.children) parent.children = []
            const id = Date.now().toString()
            parent.children.push({
                id,
                name,
                type: 'file',
                content: ''
            })
            this.activeFileId = id
            parent.isOpen = true
        }
    },

    createFolder(parentId: string, name: string) {
        const parent = this.findNode(parentId)
        if (parent && parent.type === 'folder') {
            if (!parent.children) parent.children = []
            const id = Date.now().toString()
            parent.children.push({
                id,
                name,
                type: 'folder',
                children: [],
                isOpen: true
            })
            parent.isOpen = true
        }
    },

    deleteNode(id: string) {
        // Helper to remove node from tree
        const remove = (nodes: ProjectNode[]): boolean => {
            const idx = nodes.findIndex(n => n.id === id)
            if (idx !== -1) {
                nodes.splice(idx, 1)
                return true
            }
            for (const node of nodes) {
                if (node.children && remove(node.children)) return true
            }
            return false
        }
        remove(this.files)
        if (this.activeFileId === id) {
            this.activeFileId = ''
        }
    },

    renameNode(id: string, newName: string) {
        const node = this.findNode(id)
        if (node) {
            node.name = newName
        }
    },

    createNewProject(name: string, template: string) {
        // Reset files to a new structure based on template
        this.files = [
            {
                id: 'root',
                name: name || 'src',
                type: 'folder',
                isOpen: true,
                children: []
            }
        ]
        
        if (template === 'blinky') {
            this.files[0].children?.push({
                id: '1',
                name: 'blinky.v',
                type: 'file',
                content: `module blinky(
    input clk,
    output reg led
);
    reg [25:0] count;
    always @(posedge clk) begin
        count <= count + 1;
        if (count == 0) led <= ~led;
    end
endmodule`
            })
            this.activeFileId = '1'
        } else {
            // Empty or other templates
            this.files[0].children?.push({
                id: '1',
                name: 'top.v',
                type: 'file',
                content: `module top(
    input clk
);
endmodule`
            })
            this.activeFileId = '1'
        }
    }
})
