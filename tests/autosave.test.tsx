// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushDrafts, useAutosave } from '../src/renderer/src/api'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined }; document.body.replaceChildren() })
test('close flush saves the latest draft before the debounce timer fires', async () => {
  const save = vi.fn(async (_value: string) => undefined)
  let editor!: ReturnType<typeof useAutosave>
  function Probe() { editor = useAutosave('autosave-close', '', save); return <span>{editor.value}</span> }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<Probe />))
  act(() => { editor.change('first'); editor.change('latest') })
  let success = false
  await act(async () => { success = await flushDrafts() })
  expect(success).toBe(true); expect(save).toHaveBeenCalledWith('latest'); expect(save).toHaveBeenCalledTimes(1)
})
test('failed close flush retains input, refuses close, and allows a successful retry', async () => {
  const save = vi.fn(async (_value: string) => undefined).mockRejectedValueOnce(new Error('disk full'))
  let editor!: ReturnType<typeof useAutosave>
  function Probe() { editor = useAutosave('autosave-retry', 'saved', save); return <span>{editor.value}</span> }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<Probe />))
  act(() => editor.change('unsaved note'))
  let success = true
  await act(async () => { success = await flushDrafts() })
  expect(success).toBe(false); expect(editor.value).toBe('unsaved note'); expect(editor.status).toContain('保存失败')
  await act(async () => { success = await flushDrafts() })
  expect(success).toBe(true); expect(editor.value).toBe('unsaved note'); expect(editor.status).toBe('')
})
