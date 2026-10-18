import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, Command } from '../shared/domain'

const api: Bridge = {
  invoke: (command: Command) => ipcRenderer.invoke('ling:command', command),
  onCloseRequested: flush => {
    const listener = () => { void Promise.resolve().then(flush).then(success => ipcRenderer.send('ling:close-ready', success)).catch(() => ipcRenderer.send('ling:close-ready', false)) }
    ipcRenderer.on('ling:close-request', listener)
    return () => { ipcRenderer.removeListener('ling:close-request', listener) }
  }
}
contextBridge.exposeInMainWorld('ling', api)
