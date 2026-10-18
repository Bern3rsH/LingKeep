// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AppSelect, menuPosition } from '../src/renderer/src/AppSelect'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
interface Option { value: string; label: string; disabled?: boolean }
const options: Option[] = [{ value: 'alpha', label: 'Alpha' }, { value: 'blocked', label: 'Blocked', disabled: true }, { value: 'bravo', label: 'Bravo' }, { value: 'charlie', label: 'Charlie' }]
let root: Root | undefined
let container: HTMLDivElement
const changed = vi.fn()
function Fixture({ disabled = false, items = options }: { disabled?: boolean; items?: Option[] }) {
  const [value, setValue] = useState('alpha')
  return <AppSelect aria-label="Choice" value={value} disabled={disabled} onValueChange={value => { changed(value); setValue(value) }}>{items.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</AppSelect>
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); changed.mockReset(); vi.restoreAllMocks() })
async function render(props: { disabled?: boolean; items?: Option[] } = {}) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  await act(async () => root!.render(<Fixture {...props} />))
}
const trigger = () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!
const list = () => document.querySelector<HTMLElement>('[role="listbox"]')
const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') || '')?.textContent
async function key(value: string) { await act(async () => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))) }
async function open() { await act(async () => { trigger().focus(); trigger().click() }) }

test('custom menu selects by click, preserves focus, and ignores disabled options', async () => {
  await render(); await open()
  expect(document.querySelector('select')).toBeNull()
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
  expect(trigger().getAttribute('aria-controls')).toBe(list()!.id)
  await act(async () => document.querySelector<HTMLElement>('[data-value="blocked"]')!.click())
  expect(changed).not.toHaveBeenCalled(); expect(list()).not.toBeNull()
  await act(async () => document.querySelector<HTMLElement>('[data-value="bravo"]')!.click())
  expect(changed).toHaveBeenCalledWith('bravo'); expect(trigger().value).toBe('bravo')
  expect(document.activeElement).toBe(trigger()); expect(list()).toBeNull()
})
test('keyboard navigation skips disabled options, supports Home/End and commits with Enter', async () => {
  await render(); await key('ArrowDown'); expect(active()).toBe('Alpha')
  await key('ArrowDown'); expect(active()).toBe('Bravo')
  await key('End'); expect(active()).toBe('Charlie')
  await key('ArrowDown'); expect(active()).toBe('Alpha')
  await key('Home'); await key('ArrowUp'); expect(active()).toBe('Charlie')
  await key('Enter'); expect(trigger().value).toBe('charlie'); expect(list()).toBeNull()
  expect(changed).toHaveBeenCalledTimes(1)
})
test('typeahead searches labels; Escape, Tab, blur and outside click close without selecting', async () => {
  await render(); await key('b'); expect(active()).toBe('Bravo')
  await key('Escape'); expect(list()).toBeNull(); expect(changed).not.toHaveBeenCalled()
  await open(); await key('Tab'); expect(list()).toBeNull()
  await open(); await act(async () => trigger().blur()); expect(list()).toBeNull()
  await open(); await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(list()).toBeNull(); expect(trigger().value).toBe('alpha')
})
test('disabling an open selector closes the menu; removed options cannot be selected', async () => {
  await render(); await open(); await key('ArrowDown'); expect(active()).toBe('Bravo')
  await render({ items: [options[0], options[3]] })
  expect(document.querySelector('[data-value="bravo"]')).toBeNull()
  expect(active()).toBe('Alpha')
  await render({ disabled: true }); expect(list()).toBeNull(); expect(trigger().disabled).toBe(true)
  await key('Enter'); expect(changed).not.toHaveBeenCalled()
  await render({ items: [] }); expect(trigger().disabled).toBe(true)
  await render({ items: [{ value: 'alpha', label: 'Alpha', disabled: true }] }); expect(trigger().disabled).toBe(true)
})
test('menu position flips above low triggers and stays within narrow viewports', () => {
  const below = menuPosition({ left: 30, top: 50, bottom: 96, width: 300 }, 800, 768)
  expect(below).toMatchObject({ left: 30, top: 102, width: 300, maxHeight: 280 })
  const above = menuPosition({ left: 700, top: 700, bottom: 746, width: 300 }, 800, 768)
  expect(above).toMatchObject({ left: 492, bottom: 74, width: 300, maxHeight: 280 })
  const narrow = menuPosition({ left: 30, top: 50, bottom: 96, width: 300 }, 180, 150)
  expect(narrow.width).toBe(164); expect(narrow.left).toBe(8)
  expect(Number(narrow.maxHeight)).toBeGreaterThanOrEqual(0)
})

test('scrolling the menu does not reposition it or pull it back to the highlighted item', async () => {
  await render(); await open()
  const measure = vi.spyOn(trigger(), 'getBoundingClientRect')
  const menu = list()!
  menu.scrollTop = 120
  await act(async () => menu.dispatchEvent(new Event('scroll')))
  expect(measure).not.toHaveBeenCalled()
  expect(menu.scrollTop).toBe(120)
})
test('pointer hover preserves manual scrolling; keyboard navigation reveals only the menu option', async () => {
  await render(); await open()
  const menu = list()!
  Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 76 })
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="option"]')]
  for (const [index, row] of rows.entries()) {
    Object.defineProperty(row, 'offsetTop', { configurable: true, value: index * 38 })
    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 38 })
  }
  const scrollIntoView = vi.fn(() => { menu.scrollTop = 0 })
  rows[3].scrollIntoView = scrollIntoView
  menu.scrollTop = 38
  await act(async () => rows[3].dispatchEvent(new Event('pointermove', { bubbles: true })))
  expect(menu.scrollTop).toBe(38)
  expect(scrollIntoView).not.toHaveBeenCalled()
  await key('Home'); expect(menu.scrollTop).toBe(0)
  await key('End'); expect(menu.scrollTop).toBe(76)
  expect(scrollIntoView).not.toHaveBeenCalled()
})


test('ancestor scroll and resize are coalesced per frame and pending work is cancelled on close', async () => {
  await render(); await open()
  let pending!: FrameRequestCallback
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { pending = callback; return 42 })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const measure = vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ left: 30, top: 50, bottom: 96, width: 300 } as DOMRect)
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    document.body.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
  })
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => pending(0))
  expect(measure).toHaveBeenCalledTimes(1)
  expect(list()!.style.left).toBe('30px')
  await act(async () => window.dispatchEvent(new Event('resize')))
  await key('Escape')
  expect(cancel).toHaveBeenCalledWith(42)
})
