import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Result } from '../../shared/domain'

export async function invoke(command: Command): Promise<Result> {
  const result = await window.ling.invoke(command)
  if (result.error) throw new Error(result.error)
  return result
}
const drafts = new Map<string, string>()
const flushers = new Map<string, () => Promise<void>>()
export async function flushDrafts(): Promise<boolean> {
  await Promise.all([...flushers.values()].map(flush => flush()))
  if (drafts.size) window.dispatchEvent(new CustomEvent('ling:save-error', { detail: '仍有内容保存失败，窗口已保留；请重试保存后再关闭。' }))
  return drafts.size === 0
}
export function useAutosave(key: string, initial: string, save: (value: string) => Promise<void>) {
  const [value, setValue] = useState(() => drafts.get(key) ?? initial)
  const [status, setStatus] = useState(drafts.has(key) ? '待保存' : '')
  const current = useRef(value)
  const saveRef = useRef(save); saveRef.current = save
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    if (!drafts.has(key)) return
    const text = current.current
    if (mounted.current) setStatus('保存中…')
    try {
      await saveRef.current(text)
      if (drafts.get(key) === text) drafts.delete(key)
      if (!drafts.has(key) && !mounted.current && flushers.get(key) === flush) flushers.delete(key)
      if (mounted.current && current.current === text) setStatus('')
    } catch (error) {
      const message = `保存失败：${error instanceof Error ? error.message : '请重试'}`
      if (mounted.current) setStatus(message)
      else window.dispatchEvent(new CustomEvent('ling:save-error', { detail: `${message}；输入已保留，请返回原内容重试保存。` }))
    }
  }, [key])
  useEffect(() => {
    mounted.current = true
    flushers.set(key, flush)
    if (drafts.has(key)) void flush()
    return () => {
      mounted.current = false; clearTimeout(timer.current)
      if (drafts.has(key)) void flush()
      else if (flushers.get(key) === flush) flushers.delete(key)
    }
  }, [flush, key])
  useEffect(() => {
    if (!drafts.has(key)) { current.current = initial; setValue(initial) }
  }, [initial, key])
  const change = (text: string) => {
    current.current = text; drafts.set(key, text); setValue(text); setStatus('待保存')
    clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), 350)
  }
  return { value, change, status, flush }
}
