import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SelectOption { value: string; label: string; disabled?: boolean }
interface Props { triggerLabel?: string; menuMinWidth?: number; id?: string; name?: string; 'aria-label': string; children: ReactNode; value: string; disabled?: boolean; onValueChange(value: string): void }
const MENU_MARGIN = 8
const MENU_GAP = 6
const MENU_MAX_HEIGHT = 280
const TYPEAHEAD_TIMEOUT = 700

export function menuPosition(rect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>, width: number, height: number): CSSProperties {
  const below = Math.max(0, height - rect.bottom - MENU_MARGIN - MENU_GAP)
  const above = Math.max(0, rect.top - MENU_MARGIN - MENU_GAP)
  const upwards = below < MENU_MAX_HEIGHT && above > below
  const menuWidth = Math.min(rect.width, Math.max(0, width - MENU_MARGIN * 2))
  return { left: Math.max(MENU_MARGIN, Math.min(rect.left, width - menuWidth - MENU_MARGIN)), width: menuWidth, maxHeight: Math.min(MENU_MAX_HEIGHT, upwards ? above : below), ...(upwards ? { bottom: height - rect.top + MENU_GAP } : { top: rect.bottom + MENU_GAP }) }
}

export function AppSelect({ children, value, disabled, onValueChange, id, name, triggerLabel, menuMinWidth = 0, 'aria-label': label }: Props) {
  const options = useMemo(() => Children.toArray(children).flatMap(child => isValidElement<{ value: string; children: ReactNode; disabled?: boolean }>(child) ? [{ value: child.props.value, label: Children.toArray(child.props.children).join(''), disabled: child.props.disabled }] : []), [children])
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState<string>()
  const [position, setPosition] = useState<CSSProperties>()
  const [revealRequest, setRevealRequest] = useState(0)
  const revealActive = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', time: 0 })
  const menuId = useId()
  const enabled = !disabled && options.some(option => !option.disabled)
  const expanded = open && enabled
  const selected = options.find(option => option.value === value)
  const enabledOptions = options.filter(option => !option.disabled)
  const active = options.findIndex(option => option.value === activeValue && !option.disabled)
  const activeIndex = active >= 0 ? active : options.findIndex(option => !option.disabled)

  function requestReveal() { revealActive.current = true; setRevealRequest(previous => previous + 1) }
  function show(last = false) {
    if (!enabled) return
    const initial = selected && !selected.disabled ? selected : last ? enabledOptions.at(-1) : enabledOptions[0]
    requestReveal(); setActiveValue(initial?.value); setOpen(true); search.current = { text: '', time: 0 }
  }
  function choose(option?: SelectOption) {
    if (!enabled || !option || option.disabled) return
    setOpen(false); trigger.current?.focus()
    if (option.value !== value) onValueChange(option.value)
  }
  useEffect(() => { if (!enabled) setOpen(false) }, [enabled])
  useLayoutEffect(() => {
    if (!expanded) return
    let frame: number | undefined
    const place = () => {
      if (!trigger.current) return
      const rect = trigger.current.getBoundingClientRect()
      const next = menuPosition({ left: rect.left, top: rect.top, bottom: rect.bottom, width: Math.max(rect.width, menuMinWidth) }, window.innerWidth, window.innerHeight)
      setPosition(previous => previous && previous.left === next.left && previous.width === next.width && previous.top === next.top && previous.bottom === next.bottom && previous.maxHeight === next.maxHeight ? previous : next)
    }
    const schedulePlace = () => { if (frame === undefined) frame = window.requestAnimationFrame(() => { frame = undefined; place() }) }
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) schedulePlace() }
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    place()
    window.addEventListener('resize', schedulePlace); window.addEventListener('scroll', scroll, true); document.addEventListener('pointerdown', outside)
    return () => { if (frame !== undefined) window.cancelAnimationFrame(frame); window.removeEventListener('resize', schedulePlace); window.removeEventListener('scroll', scroll, true); document.removeEventListener('pointerdown', outside) }
  }, [expanded, menuMinWidth])
  useLayoutEffect(() => {
    const viewport = menu.current
    if (!expanded || !viewport || !revealActive.current) return
    revealActive.current = false
    const option = viewport.querySelector<HTMLElement>('[data-active="true"]')
    if (!option) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = bottom - viewport.clientHeight
  }, [activeIndex, expanded, position, revealRequest])

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || !enabled) return
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape') { if (expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false) }; return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (!expanded) { show(event.key === 'ArrowUp' || event.key === 'End'); return }
      if (event.key === 'Enter' || event.key === ' ') { choose(options[activeIndex]); return }
      const current = enabledOptions.findIndex(option => option.value === options[activeIndex]?.value)
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabledOptions.length - 1 : (current + direction + enabledOptions.length) % enabledOptions.length
      requestReveal(); setActiveValue(enabledOptions[next]?.value)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const text = (now - search.current.time < TYPEAHEAD_TIMEOUT ? search.current.text : '') + event.key.toLocaleLowerCase()
      if (!expanded) show()
      search.current = { text, time: now }
      const match = enabledOptions.find(option => option.label.toLocaleLowerCase().startsWith(text))
      if (match) { requestReveal(); setActiveValue(match.value) }
    }
  }
  return <>
    <button ref={trigger} id={id} name={name} value={value} type="button" className="app-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} aria-activedescendant={expanded && activeIndex >= 0 ? `${menuId}-${activeIndex}` : undefined} disabled={!enabled} onKeyDown={keyDown} onBlur={() => setOpen(false)} onClick={() => expanded ? setOpen(false) : show()}>
      <span>{triggerLabel ?? (selected?.label || '\u00a0')}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
    </button>
    {expanded && position && createPortal(<div ref={menu} id={menuId} className="app-select-menu" role="listbox" aria-label={label} style={position} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${menuId}-${index}`} className="app-select-option" role="option" aria-selected={value === option.value} aria-disabled={option.disabled || undefined} data-value={option.value} data-active={index === activeIndex} onPointerMove={() => { if (!option.disabled) { revealActive.current = false; setActiveValue(option.value) } }} onClick={event => { event.stopPropagation(); choose(option) }}><span>{option.label}</span>{value === option.value && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 12 4 4 10-10" /></svg>}</div>)}
    </div>, document.body)}
  </>
}
