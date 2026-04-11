import { describe, expect, it } from 'vitest'

import type { IndexedBusBindingGroup } from '@/components/virtual-device/types'
import {
  applySelectedIndexedBusGroups,
  buildIndexedSignalBuses,
} from '@/components/virtual-device/binding-assist/indexed-bus-utils'

describe('indexed bus binding helpers', () => {
  it('includes scalar signals as 1-bit indexed bus candidates', () => {
    const buses = buildIndexedSignalBuses([
      { name: 'hsync', bindingLabel: 'hsync · P1' },
      { name: 'vsync', bindingLabel: 'vsync · P2' },
      { name: 'red[0]', bindingLabel: 'red[0]' },
      { name: 'red[1]', bindingLabel: 'red[1]' },
    ])

    expect(buses).toEqual([
      {
        baseName: 'hsync',
        label: 'hsync · P1',
        width: 1,
        signals: ['hsync'],
      },
      {
        baseName: 'red',
        label: 'red[0:1]',
        width: 2,
        signals: ['red[0]', 'red[1]'],
      },
      {
        baseName: 'vsync',
        label: 'vsync · P2',
        width: 1,
        signals: ['vsync'],
      },
    ])
  })

  it('applies only the selected quick-bind groups', () => {
    const groups: IndexedBusBindingGroup[] = [
      {
        key: 'hsync',
        label: 'HSync',
        width: 1,
        slotOffset: 0,
        keywords: [],
      },
      {
        key: 'vsync',
        label: 'VSync',
        width: 1,
        slotOffset: 1,
        keywords: [],
      },
      {
        key: 'red',
        label: 'Red',
        width: 2,
        slotOffset: 2,
        keywords: [],
      },
    ]

    const buses = buildIndexedSignalBuses([
      { name: 'hsync', bindingLabel: 'hsync' },
      { name: 'red[0]', bindingLabel: 'red[0]' },
      { name: 'red[1]', bindingLabel: 'red[1]' },
    ])

    const result = applySelectedIndexedBusGroups({
      currentSignals: [null, 'old_vsync', null, null],
      groups,
      selections: {
        hsync: 'hsync',
        vsync: '',
        red: 'red',
      },
      buses,
    })

    expect(result.appliedGroupCount).toBe(2)
    expect(result.nextSignals).toEqual(['hsync', 'old_vsync', 'red[0]', 'red[1]'])
  })
})
