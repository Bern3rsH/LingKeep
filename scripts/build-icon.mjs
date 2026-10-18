import { mkdir, writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'

// Match the application's green K mark without relying on platform fonts.
const SIZE = 1024
const canvas = createCanvas(SIZE, SIZE)
const context = canvas.getContext('2d')
context.fillStyle = '#305b48'
context.beginPath()
context.roundRect(64, 64, 896, 896, [256, 256, 80, 256])
context.fill()
context.fillStyle = '#ffffff'
const paths = [
  [[360, 270], [450, 270], [370, 754], [280, 754]],
  [[410, 485], [665, 270], [780, 270], [500, 510], [705, 754], [580, 754], [400, 540]]
]
for (const points of paths) {
  context.beginPath()
  points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
  context.closePath()
  context.fill()
}
await mkdir(new URL('../build/', import.meta.url), { recursive: true })
await writeFile(new URL('../build/icon.png', import.meta.url), await canvas.encode('png'))
