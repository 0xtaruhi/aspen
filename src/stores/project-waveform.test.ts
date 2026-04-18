import { describe, expect, it } from 'vitest'

import { projectWaveformStore } from './project-waveform'

describe('project waveform store', () => {
  it('normalizes persisted colors and order', () => {
    projectWaveformStore.setSnapshot({
      version: 1,
      signalOrder: [' led ', 'clk', 'led', ''],
      signalColorOverrides: {
        ' led ': ' #4f8cff ',
        empty: '',
      },
    })

    expect(projectWaveformStore.signalOrder.value).toEqual(['led', 'clk'])
    expect(projectWaveformStore.signalColorOverrides.value).toEqual({
      led: '#4f8cff',
    })
  })

  it('resets cleanly', () => {
    projectWaveformStore.setSignalOrder(['a', 'b'])
    projectWaveformStore.setSignalColor('a', '#4f8cff')

    projectWaveformStore.resetState()

    expect(projectWaveformStore.signalOrder.value).toEqual([])
    expect(projectWaveformStore.signalColorOverrides.value).toEqual({})
  })
})
