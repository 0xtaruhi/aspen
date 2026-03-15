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
})
