import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import { designContextStore } from './design-context'
import { projectStore } from './project'

describe('design context selection regression', () => {
  it('keeps top-file design context independent from active editor file changes', () => {
    projectStore.createNewProject('RegressionProject', 'blinky')
    projectStore.createFile('root', 'helper.v')

    const helperFileId = projectStore.files[0]?.children?.find(
      (node) => node.name === 'helper.v',
    )?.id

    projectStore.setActiveFile(helperFileId || '')

    expect(designContextStore.selectedSource.value?.id).toBe('1')
    expect(designContextStore.sourceName.value).toBe('blinky.v')
    expect(projectStore.topFileId).toBe('1')
    expect(projectStore.activeFileId).toBe(helperFileId)
  })

  it('prefers the explicit project top module over the first module in the file', () => {
    projectStore.createNewProject('TopModuleProject', 'empty')
    projectStore.files = [
      {
        id: 'root',
        name: 'TopModuleProject',
        type: 'folder',
        isOpen: true,
        children: [
          {
            id: 'top-file',
            name: 'top.v',
            type: 'file',
            content: `module helper(input wire a, output wire y);
  assign y = a;
endmodule

module actual_top(input wire clk, output wire led);
  assign led = clk;
endmodule`,
          },
        ],
      },
    ]
    projectStore.topFileId = 'top-file'
    projectStore.activeFileId = 'top-file'
    projectStore.selectedNodeId = 'top-file'

    expect(designContextStore.primaryModule.value).toBe('helper')

    projectStore.setTopModuleName('actual_top')

    expect(designContextStore.primaryModule.value).toBe('actual_top')
  })

  it('keeps sourceName empty when no top file is selected', () => {
    projectStore.createNewProject('NoTopFileProject', 'empty')
    projectStore.topFileId = ''

    expect(designContextStore.selectedSource.value).toBeNull()
    expect(designContextStore.sourceName.value).toBe('')
  })

  it('keeps the last valid module list while the current top file is temporarily invalid', async () => {
    projectStore.createNewProject('TransientParseProject', 'empty')
    projectStore.files = [
      {
        id: 'root',
        name: 'TransientParseProject',
        type: 'folder',
        isOpen: true,
        children: [
          {
            id: 'top-file',
            name: 'top.v',
            type: 'file',
            content: `module helper(input wire a, output wire y);
  assign y = a;
endmodule

module actual_top(input wire clk, output wire led);
  assign led = clk;
endmodule`,
          },
        ],
      },
    ]
    projectStore.topFileId = 'top-file'
    projectStore.activeFileId = 'top-file'
    projectStore.selectedNodeId = 'top-file'
    await nextTick()

    expect(designContextStore.moduleNames.value).toEqual(['helper', 'actual_top'])
    expect(designContextStore.moduleNamesStale.value).toBe(false)

    const topFile = projectStore.files[0]?.children?.[0]
    if (!topFile || topFile.type !== 'file') {
      throw new Error('Expected top file fixture to exist.')
    }

    topFile.content = '// editing in progress'
    await nextTick()

    expect(designContextStore.moduleNames.value).toEqual(['helper', 'actual_top'])
    expect(designContextStore.moduleNamesStale.value).toBe(true)
    expect(designContextStore.primaryModule.value).toBe('helper')
  })

  it('collects detected modules from every hardware source in the project', () => {
    projectStore.createNewProject('MultiFileProject', 'empty')
    projectStore.files = [
      {
        id: 'root',
        name: 'MultiFileProject',
        type: 'folder',
        isOpen: true,
        children: [
          {
            id: 'top-file',
            name: 'top.sv',
            type: 'file',
            content: `module automatic actual_top(input logic clk, output logic led);
  assign led = clk;
endmodule`,
          },
          {
            id: 'helper-file',
            name: 'helper.v',
            type: 'file',
            content: `module helper(input wire a, output wire y);
  assign y = a;
endmodule`,
          },
        ],
      },
    ]
    projectStore.topFileId = 'top-file'
    projectStore.activeFileId = 'top-file'
    projectStore.selectedNodeId = 'top-file'

    expect(designContextStore.moduleSources.value).toHaveLength(2)
    expect(designContextStore.moduleSources.value.map((source) => source.path)).toEqual([
      'MultiFileProject/top.sv',
      'MultiFileProject/helper.v',
    ])
    expect(designContextStore.moduleSources.value.map((source) => source.moduleNames)).toEqual([
      ['actual_top'],
      ['helper'],
    ])
  })
})
