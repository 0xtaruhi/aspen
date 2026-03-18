import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConverterFactory } from 'opencc-js/core'
import fromCn from 'opencc-js/from/cn'
import toTwp from 'opencc-js/to/twp'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const inputPath = path.join(rootDir, 'src/lib/locales/zh-CN.json')
const overridesPath = path.join(rootDir, 'src/lib/locales/zh-TW.overrides.json')
const outputPath = path.join(rootDir, 'src/lib/locales/zh-TW.json')

const convertToTraditionalChinese = ConverterFactory(fromCn, toTwp)
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const overrides = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
  : {}

for (const key of Object.keys(overrides)) {
  if (!(key in source)) {
    throw new Error(`Unknown zh-TW override key: ${key}`)
  }
}

const translated = Object.fromEntries(
  Object.entries(source).map(([key, value]) => [key, convertToTraditionalChinese(value)]),
)
const localized = {
  ...translated,
  ...overrides,
}

fs.writeFileSync(outputPath, JSON.stringify(localized, null, 2) + '\n')
console.log(
  `Generated ${path.relative(rootDir, outputPath)} from zh-CN locale with ${Object.keys(overrides).length} override(s).`,
)
