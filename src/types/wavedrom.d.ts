declare module '@wavedrom-render-any' {
  export type WaveDromSource = Record<string, unknown>
  export type OnmlNode = unknown

  export default function renderAny(
    index: number,
    source: WaveDromSource,
    waveSkin: unknown,
    notFirstSignal?: boolean,
  ): OnmlNode
}

declare module '@wavedrom-skin-default' {
  const waveSkin: unknown
  export default waveSkin
}

declare module '@onml-stringify' {
  export default function stringify(node: unknown): string
}
