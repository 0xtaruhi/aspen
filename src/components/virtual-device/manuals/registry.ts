import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'
import zhTwGeneratedTextRaw from './zh-TW.generated.json'
import {
  CANVAS_DEVICE_PRESET_COLORS,
  getCanvasButtonConfig,
  getCanvasDeviceDefinition,
  getCanvasDipSwitchBankConfig,
  getCanvasHd44780LcdConfig,
  getCanvasLedBarConfig,
  getCanvasMatrixDimensions,
  getCanvasMatrixKeypadConfig,
  getCanvasQuadratureEncoderConfig,
  getCanvasSegmentDisplayConfig,
  getCanvasUartTerminalConfig,
  getCanvasVgaDisplayConfig,
  resolveCanvasDeviceColor,
  vgaColorModeBitCounts,
} from '@/lib/canvas-devices'

type SupportedLanguage = 'en-US' | 'zh-CN' | 'zh-TW'
type LocalizedText = string | Partial<Record<SupportedLanguage, string>>
type ManualPinDirection = 'fpga_to_device' | 'device_to_fpga' | 'bidirectional'

type ManualPin = {
  name: string
  direction: ManualPinDirection
  description: string
}

type ManualParameter = {
  name: string
  value: string
  defaultValue: string | null
  description: string
}

type ManualWaveform = {
  id: string
  title: string
  description: string
  source: Record<string, unknown>
}

type ManualWaveformDefinition = {
  id: string
  title: LocalizedText
  description: LocalizedText
  source: Record<string, unknown>
}

type ResolvedCanvasDeviceManual = {
  title: string
  summary: string
  markdown: string
  pins: ManualPin[]
  parameters: ManualParameter[]
  waveforms: ManualWaveform[]
}

type CanvasDeviceManualDefinition = {
  summary: LocalizedText
  resolvePins: (device: CanvasDeviceSnapshot, language: SupportedLanguage) => ManualPin[]
  resolveParameters?: (
    device: CanvasDeviceSnapshot,
    language: SupportedLanguage,
  ) => ManualParameter[]
  resolveWaveforms?: (
    device: CanvasDeviceSnapshot,
    language: SupportedLanguage,
  ) => ManualWaveformDefinition[]
}

const manualMarkdownModules = import.meta.glob('./content/*/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>
const zhTwGeneratedText = zhTwGeneratedTextRaw as Record<string, string>

function txt(en: string, zhCn: string): LocalizedText {
  return { 'en-US': en, 'zh-CN': zhCn }
}

function resolveText(value: LocalizedText, language: SupportedLanguage) {
  if (typeof value === 'string') {
    return value
  }

  if (language === 'zh-TW') {
    return (
      value['zh-TW'] ??
      (value['zh-CN'] ? zhTwGeneratedText[value['zh-CN']] : undefined) ??
      value['zh-CN'] ??
      value['en-US'] ??
      ''
    )
  }

  return value[language] ?? value['zh-CN'] ?? value['en-US'] ?? ''
}

function resolveMarkdown(type: CanvasDeviceType, language: SupportedLanguage) {
  const candidates =
    language === 'zh-TW' ? ['zh-TW', 'zh-CN', 'en-US'] : [language, 'zh-CN', 'en-US']

  for (const candidate of candidates) {
    const key = `./content/${candidate}/${type}.md`
    const content = manualMarkdownModules[key]
    if (typeof content === 'string') {
      return content
    }
  }

  return ''
}

function enabledValue(value: boolean, language: SupportedLanguage) {
  return value
    ? resolveText(txt('Enabled', '启用'), language)
    : resolveText(txt('Disabled', '禁用'), language)
}

function activeLevelValue(activeLow: boolean, language: SupportedLanguage) {
  return activeLow
    ? resolveText(txt('Active low', '低电平有效'), language)
    : resolveText(txt('Active high', '高电平有效'), language)
}

function uartModeValue(mode: 'tx' | 'rx' | 'tx_rx', language: SupportedLanguage) {
  switch (mode) {
    case 'tx':
      return resolveText(txt('TX only', '仅发送'), language)
    case 'rx':
      return resolveText(txt('RX only', '仅接收'), language)
    case 'tx_rx':
    default:
      return resolveText(txt('TX + RX', '收发双向'), language)
  }
}

function busModeValue(mode: '4bit' | '8bit', language: SupportedLanguage) {
  return mode === '8bit'
    ? resolveText(txt('8-bit bus', '8 位总线'), language)
    : resolveText(txt('4-bit bus', '4 位总线'), language)
}

function vgaColorModeValue(
  mode: 'mono' | 'rgb111' | 'rgb332' | 'rgb444' | 'rgb565' | 'rgb888',
  language: SupportedLanguage,
) {
  const labels: Record<typeof mode, LocalizedText> = {
    mono: txt('Monochrome', '单色'),
    rgb111: txt('RGB111', 'RGB111'),
    rgb332: txt('RGB332', 'RGB332'),
    rgb444: txt('RGB444', 'RGB444'),
    rgb565: txt('RGB565', 'RGB565'),
    rgb888: txt('RGB888', 'RGB888'),
  }

  return resolveText(labels[mode], language)
}

function resolveColorValue(device: CanvasDeviceSnapshot, language: SupportedLanguage) {
  const color = resolveCanvasDeviceColor(device)
  if (!color) {
    return resolveText(txt('Automatic', '自动'), language)
  }

  const namedEntry = Object.entries(CANVAS_DEVICE_PRESET_COLORS).find(
    ([, value]) => value === color,
  )
  if (!namedEntry) {
    return color
  }

  const labelByName: Record<string, LocalizedText> = {
    red: txt('Red', '红色'),
    green: txt('Green', '绿色'),
    blue: txt('Blue', '蓝色'),
    yellow: txt('Yellow', '黄色'),
    orange: txt('Orange', '橙色'),
    white: txt('White', '白色'),
  }

  const label = labelByName[namedEntry[0]]
  return label ? `${resolveText(label, language)} (${color})` : color
}

function pin(
  name: string,
  direction: ManualPinDirection,
  description: LocalizedText,
  language: SupportedLanguage,
): ManualPin {
  return {
    name,
    direction,
    description: resolveText(description, language),
  }
}

function parameter(
  name: string,
  value: string | number,
  defaultValue: string | number | null,
  description: LocalizedText,
  language: SupportedLanguage,
): ManualParameter {
  return {
    name,
    value: String(value),
    defaultValue: defaultValue === null ? null : String(defaultValue),
    description: resolveText(description, language),
  }
}

function resolveWaveforms(
  definitions: ManualWaveformDefinition[] | undefined,
  language: SupportedLanguage,
) {
  return (definitions ?? []).map((definition) => ({
    id: definition.id,
    title: resolveText(definition.title, language),
    description: resolveText(definition.description, language),
    source: definition.source,
  }))
}

const canvasDeviceManualDefinitions: Record<CanvasDeviceType, CanvasDeviceManualDefinition> = {
  led: {
    summary: txt(
      'Observe one logic output from the design as an indicator lamp.',
      '把设计中的单根逻辑输出映射成一个指示灯，适合看心跳、状态位和握手信号。',
    ),
    resolvePins: (_device, language) => [
      pin(
        'SIG',
        'fpga_to_device',
        txt(
          'Observed logic level from the design. High turns the lamp on.',
          '来自设计的被观察信号。高电平时点亮灯。',
        ),
        language,
      ),
    ],
    resolveParameters: (device, language) => [
      parameter(
        'Display color',
        resolveColorValue(device, language),
        `${resolveText(txt('Red', '红色'), language)} (${CANVAS_DEVICE_PRESET_COLORS.red})`,
        txt(
          'Display color only; does not affect electrical behavior.',
          '仅影响显示颜色，不改变电气语义。',
        ),
        language,
      ),
    ],
    resolveWaveforms: (_device, _language) => [
      {
        id: 'led-level',
        title: txt('Level to lamp state', '电平到灯态'),
        description: txt(
          'The LED follows the sampled signal level directly.',
          'LED 直接跟随采样到的信号电平变化。',
        ),
        source: {
          signal: [
            { name: 'SIG', wave: '0.1..0.' },
            { name: 'LED', wave: '0.1..0.' },
          ],
        },
      },
    ],
  },
  switch: {
    summary: txt(
      'Drive one logic input into the design with a persistent toggle.',
      '用拨杆持续驱动设计中的单根逻辑输入，适合模式选择、使能和静态控制。',
    ),
    resolvePins: (_device, language) => [
      pin(
        'SIG',
        'device_to_fpga',
        txt('Driven from the virtual switch into the design.', '由虚拟拨杆驱动到设计输入端口。'),
        language,
      ),
    ],
    resolveWaveforms: (_device, _language) => [
      {
        id: 'switch-toggle',
        title: txt('Toggle drive', '拨杆驱动'),
        description: txt(
          'Each toggle updates the driven level until the switch changes again.',
          '每次切换都会改变输出电平，并保持到下一次拨动为止。',
        ),
        source: {
          signal: [
            { name: 'User', wave: 'l.h..l.' },
            { name: 'SIG', wave: '0.1..0.' },
          ],
        },
      },
    ],
  },
  button: {
    summary: txt(
      'Momentary push-button input with selectable active level.',
      '瞬时按键输入器件，可选择按下时输出高电平还是低电平。',
    ),
    resolvePins: (_device, language) => [
      pin(
        'BTN',
        'device_to_fpga',
        txt(
          'Momentary signal driven while the button is pressed.',
          '按下期间由器件驱动到设计的瞬时信号。',
        ),
        language,
      ),
    ],
    resolveParameters: (device, language) => {
      const config = getCanvasButtonConfig(device)
      const activeLow = config?.activeLow ?? false
      return [
        parameter(
          'Pressed level',
          activeLevelValue(activeLow, language),
          resolveText(txt('Active high', '高电平有效'), language),
          txt(
            'Signal level driven while the button is held down.',
            '按键保持按下时输出到设计的信号极性。',
          ),
          language,
        ),
      ]
    },
    resolveWaveforms: (device, _language) => {
      const activeLow = getCanvasButtonConfig(device)?.activeLow ?? false
      return [
        {
          id: 'button-press',
          title: txt('Momentary press', '瞬时按下'),
          description: activeLow
            ? txt(
                'This button instance is configured as active low.',
                '该按键当前配置为低电平有效。',
              )
            : txt(
                'This button instance is configured as active high.',
                '该按键当前配置为高电平有效。',
              ),
          source: {
            signal: activeLow
              ? [
                  { name: 'Pressed', wave: '0.1..0.' },
                  { name: 'BTN', wave: '1.0..1.' },
                ]
              : [
                  { name: 'Pressed', wave: '0.1..0.' },
                  { name: 'BTN', wave: '0.1..0.' },
                ],
          },
        },
      ]
    },
  },
  dip_switch_bank: {
    summary: txt(
      'Drive a parallel input bus into the design with per-bit toggles.',
      '用一组独立拨码开关并行驱动设计输入总线，适合配置字和测试向量。',
    ),
    resolvePins: (device, language) => {
      const width = getCanvasDipSwitchBankConfig(device)?.width ?? 8
      return Array.from({ length: width }, (_, index) =>
        pin(
          `SW${index}`,
          'device_to_fpga',
          txt(
            `Bus bit ${index} driven by switch ${index}.`,
            `由第 ${index} 个拨码开关驱动的总线位。`,
          ),
          language,
        ),
      )
    },
    resolveParameters: (device, language) => {
      const width = getCanvasDipSwitchBankConfig(device)?.width ?? 8
      return [
        parameter(
          'Width',
          width,
          8,
          txt('Number of bus bits exposed by the switch bank.', '拨码开关组暴露给设计的位宽。'),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'dip-parallel',
        title: txt('Parallel bus drive', '并行总线驱动'),
        description: txt(
          'Each switch controls one independent output bit.',
          '每个拨码开关独立控制一个输出位。',
        ),
        source: {
          signal: [
            { name: 'SW0', wave: '0.1....' },
            { name: 'SW1', wave: '0..1...' },
            { name: 'SW2', wave: '1...0..' },
          ],
        },
      },
    ],
  },
  led_bar: {
    summary: txt(
      'Observe a parallel output bus as a row of LEDs.',
      '把设计输出总线映射成一排 LED，适合快速观察状态字和计数值。',
    ),
    resolvePins: (device, language) => {
      const width = getCanvasLedBarConfig(device)?.width ?? 8
      return Array.from({ length: width }, (_, index) =>
        pin(
          `LED${index}`,
          'fpga_to_device',
          txt(`Observed bus bit ${index}.`, `被观察的总线位 ${index}。`),
          language,
        ),
      )
    },
    resolveParameters: (device, language) => {
      const config = getCanvasLedBarConfig(device)
      return [
        parameter(
          'Width',
          config?.width ?? 8,
          8,
          txt('Number of monitored output bits.', '被监视输出位的数量。'),
          language,
        ),
        parameter(
          'Lit level',
          activeLevelValue(config?.activeLow ?? false, language),
          resolveText(txt('Active high', '高电平有效'), language),
          txt('Choose which logic level lights a segment.', '选择哪种逻辑电平会点亮灯条单元。'),
          language,
        ),
        parameter(
          'Display color',
          resolveColorValue(device, language),
          `${resolveText(txt('Green', '绿色'), language)} (${CANVAS_DEVICE_PRESET_COLORS.green})`,
          txt(
            'Display color only; does not affect sampled logic.',
            '仅影响显示颜色，不改变采样逻辑。',
          ),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'led-bar-bus',
        title: txt('Observed bus bits', '总线位观察'),
        description: txt(
          'Each bar segment reflects one sampled output bit.',
          '每个灯条单元反映一个被采样的输出位。',
        ),
        source: {
          signal: [
            { name: 'LED0', wave: '0.1....' },
            { name: 'LED1', wave: '0..1...' },
            { name: 'LED2', wave: '0...1..' },
          ],
        },
      },
    ],
  },
  audio_pwm: {
    summary: txt(
      'Observe a PWM-style audio output and estimate frequency and duty cycle from the live stream.',
      '观察 PWM 音频输出，并根据实时数据流估算频率和占空比。',
    ),
    resolvePins: (_device, language) => [
      pin(
        'PWM',
        'fpga_to_device',
        txt('Observed pulse waveform from the design.', '来自设计的被观察脉冲波形。'),
        language,
      ),
    ],
    resolveWaveforms: (_device, _language) => [
      {
        id: 'audio-pwm',
        title: txt('PWM pulse train', 'PWM 脉冲串'),
        description: txt(
          'Frequency is estimated from rising-edge spacing in the sampled stream.',
          '频率通过数据流中相邻上升沿的间隔估算得到。',
        ),
        source: {
          signal: [
            { name: 'PWM', wave: 'p..p..p.', period: 2 },
            { name: 'Duty', wave: '=.==.==.', data: ['50%', '25%', '75%'] },
          ],
        },
      },
    ],
  },
  quadrature_encoder: {
    summary: txt(
      'Drive A/B quadrature phases into the design and optionally a push switch.',
      '向设计注入 A/B 正交相位信号，并可选带一个按压开关。',
    ),
    resolvePins: (device, language) => {
      const hasButton = getCanvasQuadratureEncoderConfig(device)?.hasButton ?? true
      return [
        pin('A', 'device_to_fpga', txt('Quadrature phase A.', '正交相位 A。'), language),
        pin('B', 'device_to_fpga', txt('Quadrature phase B.', '正交相位 B。'), language),
        ...(hasButton
          ? [pin('SW', 'device_to_fpga', txt('Encoder push switch.', '编码器按压开关。'), language)]
          : []),
      ]
    },
    resolveParameters: (device, language) => {
      const hasButton = getCanvasQuadratureEncoderConfig(device)?.hasButton ?? true
      return [
        parameter(
          'Push switch',
          enabledValue(hasButton, language),
          resolveText(txt('Enabled', '启用'), language),
          txt('Expose an extra switch output alongside A/B.', '是否额外导出一个按压开关信号。'),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'encoder-ab',
        title: txt('Quadrature sequence', '正交序列'),
        description: txt(
          'Clockwise rotation advances phase A ahead of B.',
          '顺时针旋转时，A 相位超前于 B 相位。',
        ),
        source: {
          signal: [
            { name: 'A', wave: '0.1.0.1.' },
            { name: 'B', wave: '0..1.0.1' },
            { name: 'SW', wave: '0.....1.' },
          ],
        },
      },
    ],
  },
  matrix_keypad: {
    summary: txt(
      'Simulate a scanned matrix keypad by observing row selects and driving matching columns.',
      '模拟扫描式矩阵键盘：观察设计驱动的行选通信号，并在按键命中时回驱对应列线。',
    ),
    resolvePins: (device, language) => {
      const config = getCanvasMatrixKeypadConfig(device)
      const rows = config?.rows ?? 4
      const columns = config?.columns ?? 4
      return [
        ...Array.from({ length: rows }, (_, index) =>
          pin(
            `ROW${index}`,
            'fpga_to_device',
            txt(
              `Row select line ${index} observed from the design.`,
              `从设计观察到的第 ${index} 行扫描信号。`,
            ),
            language,
          ),
        ),
        ...Array.from({ length: columns }, (_, index) =>
          pin(
            `COL${index}`,
            'device_to_fpga',
            txt(
              `Column sense line ${index} driven back when the selected key is pressed.`,
              `当选中的按键被按下时，器件会回驱第 ${index} 列感测线。`,
            ),
            language,
          ),
        ),
      ]
    },
    resolveParameters: (device, language) => {
      const config = getCanvasMatrixKeypadConfig(device)
      return [
        parameter(
          'Rows',
          config?.rows ?? 4,
          4,
          txt('Number of scanned rows.', '矩阵键盘的行数。'),
          language,
        ),
        parameter(
          'Columns',
          config?.columns ?? 4,
          4,
          txt('Number of sensed columns.', '矩阵键盘的列数。'),
          language,
        ),
        parameter(
          'Active level',
          activeLevelValue(config?.activeLow ?? true, language),
          resolveText(txt('Active low', '低电平有效'), language),
          txt(
            'Electrical polarity used when a key closes the row/column path.',
            '按键闭合时用于列线回驱的有效电平极性。',
          ),
          language,
        ),
      ]
    },
    resolveWaveforms: (device, _language) => {
      const activeLow = getCanvasMatrixKeypadConfig(device)?.activeLow ?? true
      return [
        {
          id: 'matrix-scan',
          title: txt('Scan and key closure', '扫描与按键闭合'),
          description: activeLow
            ? txt(
                'With active-low sensing, the pressed column is driven low when its row is selected.',
                '在低电平有效模式下，当对应行被选中时，被按下按键所在列会被拉低。',
              )
            : txt(
                'With active-high sensing, the pressed column is driven high when its row is selected.',
                '在高电平有效模式下，当对应行被选中时，被按下按键所在列会被拉高。',
              ),
          source: {
            signal: activeLow
              ? [
                  { name: 'ROW1', wave: '0..1..0.' },
                  { name: 'Pressed', wave: '0.1....0' },
                  { name: 'COL2', wave: '1..0..1.' },
                ]
              : [
                  { name: 'ROW1', wave: '0..1..0.' },
                  { name: 'Pressed', wave: '0.1....0' },
                  { name: 'COL2', wave: '0..1..0.' },
                ],
          },
        },
      ]
    },
  },
  uart_terminal: {
    summary: txt(
      'Bidirectional UART terminal for sending serial data into RX and observing TX output.',
      '双向 UART 终端，可向 RX 发送串口数据，也可观察 TX 输出。',
    ),
    resolvePins: (device, language) => {
      const mode = getCanvasUartTerminalConfig(device)?.mode ?? 'tx_rx'
      const pins: ManualPin[] = []

      if (mode !== 'tx') {
        pins.push(
          pin(
            'RX',
            'device_to_fpga',
            txt('Serial line driven into the design RX input.', '驱动到设计 RX 输入的串行线。'),
            language,
          ),
        )
      }

      if (mode !== 'rx') {
        pins.push(
          pin(
            'TX',
            'fpga_to_device',
            txt(
              'Serial line observed from the design TX output.',
              '从设计 TX 输出观察到的串行线。',
            ),
            language,
          ),
        )
      }

      return pins
    },
    resolveParameters: (device, language) => {
      const config = getCanvasUartTerminalConfig(device)
      return [
        parameter(
          'Mode',
          uartModeValue(config?.mode ?? 'tx_rx', language),
          resolveText(txt('TX + RX', '收发双向'), language),
          txt('Select which UART directions are enabled.', '选择启用哪些 UART 方向。'),
          language,
        ),
        parameter(
          'Cycles per bit',
          config?.cyclesPerBit ?? 16,
          16,
          txt(
            'Sampling cycles per UART bit inside the live stream.',
            '实时数据流中每个 UART bit 对应的采样周期数。',
          ),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'uart-frame',
        title: txt('8N1 frame', '8N1 帧格式'),
        description: txt(
          'Idle stays high, followed by start bit, 8 data bits, then stop bit.',
          '串口空闲为高电平，随后是起始位、8 个数据位和停止位。',
        ),
        source: {
          signal: [
            {
              name: 'UART',
              wave: '1.0========1',
              data: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'],
            },
          ],
          head: { text: '8N1' },
        },
      },
    ],
  },
  hd44780_lcd: {
    summary: txt(
      'Observe a write-only HD44780-compatible bus and render its DDRAM text contents.',
      '观察 HD44780 兼容总线的写操作，并把写入 DDRAM 的字符渲染到虚拟 LCD 上。',
    ),
    resolvePins: (device, language) => {
      const config = getCanvasHd44780LcdConfig(device)
      const busMode = config?.busMode ?? '4bit'
      const dataBits = busMode === '8bit' ? [0, 1, 2, 3, 4, 5, 6, 7] : [4, 5, 6, 7]
      return [
        pin(
          'RS',
          'fpga_to_device',
          txt('Register select: command vs data.', '寄存器选择：命令或数据。'),
          language,
        ),
        pin(
          'E',
          'fpga_to_device',
          txt(
            'Enable strobe; data is latched on the falling edge.',
            '使能脉冲；数据在下降沿锁存。',
          ),
          language,
        ),
        pin(
          'RW',
          'fpga_to_device',
          txt(
            'Read/write select. Reads are ignored by the current virtual model.',
            '读写选择。当前虚拟模型忽略读周期。',
          ),
          language,
        ),
        ...dataBits.map((bit) =>
          pin(
            `D${bit}`,
            'fpga_to_device',
            txt(`Parallel LCD data bit ${bit}.`, `LCD 并行数据位 D${bit}。`),
            language,
          ),
        ),
      ]
    },
    resolveParameters: (device, language) => {
      const config = getCanvasHd44780LcdConfig(device)
      return [
        parameter(
          'Columns',
          config?.columns ?? 16,
          16,
          txt('Visible character columns.', '显示的字符列数。'),
          language,
        ),
        parameter(
          'Rows',
          config?.rows ?? 2,
          2,
          txt('Visible character rows.', '显示的字符行数。'),
          language,
        ),
        parameter(
          'Bus mode',
          busModeValue(config?.busMode ?? '4bit', language),
          resolveText(txt('4-bit bus', '4 位总线'), language),
          txt(
            'Choose between 4-bit and 8-bit HD44780 wiring.',
            '选择 4 位或 8 位 HD44780 接线方式。',
          ),
          language,
        ),
      ]
    },
    resolveWaveforms: (device, _language) => {
      const busMode = getCanvasHd44780LcdConfig(device)?.busMode ?? '4bit'
      return [
        {
          id: 'hd44780-write',
          title: txt('LCD write cycle', 'LCD 写周期'),
          description:
            busMode === '8bit'
              ? txt(
                  'In 8-bit mode one falling edge of E transfers the whole byte.',
                  '在 8 位模式下，E 的一个下降沿就会传输整个字节。',
                )
              : txt(
                  'In 4-bit mode the high nibble and low nibble are latched on two falling edges of E.',
                  '在 4 位模式下，高四位和低四位分别在 E 的两个下降沿锁存。',
                ),
          source:
            busMode === '8bit'
              ? {
                  signal: [
                    { name: 'RS', wave: '0.....1.' },
                    { name: 'RW', wave: '0.......' },
                    { name: 'E', wave: '0..10...' },
                    { name: 'D[7:0]', wave: 'x.==x...', data: ['CMD', 'DATA'] },
                  ],
                }
              : {
                  signal: [
                    { name: 'RS', wave: '1.......' },
                    { name: 'RW', wave: '0.......' },
                    { name: 'E', wave: '0.1010..' },
                    { name: 'D[7:4]', wave: 'x.=.=x..', data: ['HI', 'LO'] },
                  ],
                },
        },
      ]
    },
  },
  vga_display: {
    summary: txt(
      'Observe sync and RGB buses, then rasterize the active window into a virtual display.',
      '观察同步信号和 RGB 总线，并把活动显示窗口栅格化到虚拟屏幕中。',
    ),
    resolvePins: (device, language) => {
      const config = getCanvasVgaDisplayConfig(device)
      const bits = vgaColorModeBitCounts(config?.colorMode ?? 'rgb332')
      return [
        pin(
          'HSYNC',
          'fpga_to_device',
          txt('Horizontal sync from the design.', '来自设计的行同步信号。'),
          language,
        ),
        pin(
          'VSYNC',
          'fpga_to_device',
          txt('Vertical sync from the design.', '来自设计的场同步信号。'),
          language,
        ),
        ...Array.from({ length: bits.redBits }, (_, index) =>
          pin(
            `R${index}`,
            'fpga_to_device',
            txt(`Red channel bit ${index}.`, `红色通道位 R${index}。`),
            language,
          ),
        ),
        ...Array.from({ length: bits.greenBits }, (_, index) =>
          pin(
            `G${index}`,
            'fpga_to_device',
            txt(`Green channel bit ${index}.`, `绿色通道位 G${index}。`),
            language,
          ),
        ),
        ...Array.from({ length: bits.blueBits }, (_, index) =>
          pin(
            `B${index}`,
            'fpga_to_device',
            txt(`Blue channel bit ${index}.`, `蓝色通道位 B${index}。`),
            language,
          ),
        ),
      ]
    },
    resolveParameters: (device, language) => {
      const config = getCanvasVgaDisplayConfig(device)
      return [
        parameter(
          'Resolution',
          `${config?.columns ?? 320} × ${config?.rows ?? 240}`,
          '320 × 240',
          txt(
            'Capture resolution used by the virtual rasterizer.',
            '虚拟光栅化器使用的采样分辨率。',
          ),
          language,
        ),
        parameter(
          'Color mode',
          vgaColorModeValue(config?.colorMode ?? 'rgb332', language),
          resolveText(txt('RGB332', 'RGB332'), language),
          txt('Expected RGB bus width and packing.', '期望的 RGB 总线位宽与颜色打包方式。'),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'vga-frame',
        title: txt('Raster sampling', '光栅采样'),
        description: txt(
          'The display locks on HSYNC/VSYNC edges and samples RGB during the visible region.',
          '显示器会根据 HSYNC/VSYNC 边界组织帧，并在可见区采样 RGB 数据。',
        ),
        source: {
          signal: [
            { name: 'HSYNC', wave: '10..10..10..' },
            { name: 'VSYNC', wave: '1......0....' },
            { name: 'VISIBLE', wave: '0.111100.111' },
            { name: 'RGB', wave: 'x.==xx=.==x', data: ['P0', 'P1', 'P2', 'P3', 'P4'] },
          ],
        },
      },
    ],
  },
  segment_display: {
    summary: txt(
      'Observe segment lines and optional digit selects to reconstruct a 7-segment display.',
      '观察段选线和可选的位选线，重建数码管显示内容。',
    ),
    resolvePins: (device, language) => {
      const config = getCanvasSegmentDisplayConfig(device)
      const digits = config?.digits ?? 1
      return [
        ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map((label) =>
          pin(
            label,
            'fpga_to_device',
            txt(`Observed segment line ${label}.`, `被观察的段选线 ${label}。`),
            language,
          ),
        ),
        ...(digits > 1
          ? Array.from({ length: digits }, (_, index) =>
              pin(
                `DIG${index}`,
                'fpga_to_device',
                txt(`Observed digit-select line ${index}.`, `被观察的位选线 ${index}。`),
                language,
              ),
            )
          : []),
      ]
    },
    resolveParameters: (device, language) => {
      const config = getCanvasSegmentDisplayConfig(device)
      return [
        parameter(
          'Digits',
          config?.digits ?? 1,
          1,
          txt('Number of digits to decode.', '需要解码的数码管位数。'),
          language,
        ),
        parameter(
          'Lit level',
          activeLevelValue(config?.activeLow ?? false, language),
          resolveText(txt('Active high', '高电平有效'), language),
          txt('Choose whether a lit segment is driven high or low.', '选择点亮段时的有效电平。'),
          language,
        ),
      ]
    },
    resolveWaveforms: (device, _language) => {
      const digits = getCanvasSegmentDisplayConfig(device)?.digits ?? 1
      return [
        {
          id: 'segment-scan',
          title: txt('Segment scan', '数码管扫描'),
          description:
            digits > 1
              ? txt(
                  'For multi-digit displays, segment data is interpreted together with the active digit-select line.',
                  '对于多位数码管，会结合段选总线和当前有效的位选线来解释显示内容。',
                )
              : txt(
                  'Single-digit displays are decoded directly from the segment bus.',
                  '单个数码管会直接根据段选总线解码。',
                ),
          source:
            digits > 1
              ? {
                  signal: [
                    { name: 'DIG0', wave: '10..10..' },
                    { name: 'DIG1', wave: '01..01..' },
                    { name: 'SEG[7:0]', wave: 'x.=..=.x', data: ['0', '1'] },
                  ],
                }
              : {
                  signal: [{ name: 'SEG[7:0]', wave: 'x.=.=.x.', data: ['0', 'A', 'F'] }],
                },
        },
      ]
    },
  },
  led_matrix: {
    summary: txt(
      'Observe a scanned row/column matrix and accumulate it into a pixel image.',
      '观察行列扫描的点阵信号，并把扫描结果积累成像素图像。',
    ),
    resolvePins: (device, language) => {
      const dimensions = getCanvasMatrixDimensions(device)
      const rows = dimensions?.rows ?? 8
      const columns = dimensions?.columns ?? 8
      return [
        ...Array.from({ length: rows }, (_, index) =>
          pin(
            `ROW${index}`,
            'fpga_to_device',
            txt(`Observed row-select line ${index}.`, `被观察的行选线 ${index}。`),
            language,
          ),
        ),
        ...Array.from({ length: columns }, (_, index) =>
          pin(
            `COL${index}`,
            'fpga_to_device',
            txt(`Observed column data line ${index}.`, `被观察的列数据线 ${index}。`),
            language,
          ),
        ),
      ]
    },
    resolveParameters: (device, language) => {
      const dimensions = getCanvasMatrixDimensions(device)
      return [
        parameter(
          'Rows',
          dimensions?.rows ?? 8,
          8,
          txt('Number of matrix rows.', '点阵行数。'),
          language,
        ),
        parameter(
          'Columns',
          dimensions?.columns ?? 8,
          8,
          txt('Number of matrix columns.', '点阵列数。'),
          language,
        ),
        parameter(
          'Display color',
          resolveColorValue(device, language),
          `${resolveText(txt('Green', '绿色'), language)} (${CANVAS_DEVICE_PRESET_COLORS.green})`,
          txt('Display color only.', '仅影响显示颜色。'),
          language,
        ),
      ]
    },
    resolveWaveforms: (_device, _language) => [
      {
        id: 'matrix-scan',
        title: txt('Matrix scan', '点阵扫描'),
        description: txt(
          'Rows are selected over time while the column bus carries the pixel mask for that row.',
          '系统会按时间轮流选通各行，同时列总线携带当前行的像素掩码。',
        ),
        source: {
          signal: [
            { name: 'ROW0', wave: '10..10..' },
            { name: 'ROW1', wave: '01..01..' },
            { name: 'COL[7:0]', wave: 'x.=..=.x', data: ['MASK0', 'MASK1'] },
          ],
        },
      },
    ],
  },
}

export function resolveCanvasDeviceManual(
  device: CanvasDeviceSnapshot,
  language: SupportedLanguage,
): ResolvedCanvasDeviceManual {
  const definition = canvasDeviceManualDefinitions[device.type]
  return {
    title: getCanvasDeviceDefinition(device.type).title,
    summary: resolveText(definition.summary, language),
    markdown: resolveMarkdown(device.type, language),
    pins: definition.resolvePins(device, language),
    parameters: definition.resolveParameters?.(device, language) ?? [],
    waveforms: resolveWaveforms(definition.resolveWaveforms?.(device, language), language),
  }
}
