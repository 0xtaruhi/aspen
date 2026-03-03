import type { Component } from 'vue'

import BulbDisplay from './bulb/BulbDisplay.vue'
import BulbSettings from './bulb/BulbSettings.vue'
import SwitchDisplay from './switch/SwitchDisplay.vue'
import SwitchSettings from './switch/SwitchSettings.vue'

export type WidgetType = 'bulb' | 'switch'

export interface WidgetDefinition<State extends Record<string, unknown> = Record<string, unknown>> {
  type: WidgetType
  title: string
  settingsTitle?: string
  settingsDescription?: string
  display: Component
  settings: Component
  defaultState: () => State
  meta?: Record<string, unknown>
}

export interface WidgetInstance<State extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  type: WidgetType
  title: string
  state: State
}

const bulbDefinition: WidgetDefinition = {
  type: 'bulb',
  title: 'Bulb',
  settingsTitle: 'Light Settings',
  settingsDescription: 'Adjust output, color, and power state.',
  display: BulbDisplay,
  settings: BulbSettings,
  defaultState: () => ({
    power: true,
    color: '#fbbf24',
    brightness: 0.9,
    size: 120,
  }),
  meta: {
    presetColors: ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#f87171', '#a78bfa'],
  },
}

const switchDefinition: WidgetDefinition = {
  type: 'switch',
  title: 'Switch',
  settingsTitle: 'Switch',
  settingsDescription: 'No additional options.',
  display: SwitchDisplay,
  settings: SwitchSettings,
  defaultState: () => ({
    power: false,
  }),
}

export const widgetRegistry: Record<WidgetType, WidgetDefinition> = {
  bulb: bulbDefinition,
  switch: switchDefinition,
}

export function getWidgetDefinition(type: WidgetType): WidgetDefinition {
  return widgetRegistry[type]
}

export function createWidgetInstance(id: string, type: WidgetType): WidgetInstance {
  const definition = getWidgetDefinition(type)

  return {
    id,
    type,
    title: definition.title,
    state: definition.defaultState(),
  }
}
