import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Store } from './store'
import { Importer } from './imports'
import { Dictionaries } from './dictionary'
import { AI } from './ai'
import { Application } from './application'
import { runSmoke } from './smoke'

app.setName('LingKeep')
// Keep the existing data directory when changing the display name.
app.setPath('userData', process.env.LING_KEEP_DATA_DIR || join(app.getPath('appData'), 'Ling Keep'))
protocol.registerSchemesAsPrivileged([{ scheme: 'ling-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window: BrowserWindow | undefined
  app.on('second-instance', () => { window?.show(); window?.focus() })
  app.whenReady().then(async () => {
    const directory = app.getPath('userData')
    const importer = new Importer(join(directory, 'assets'))
    const store = new Store(join(directory, 'state.json'))
    const application = new Application(store, importer, new Dictionaries(join(app.getAppPath(), 'resources/dictionaries')), new AI(), async kind => {
      const choice = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: kind.toUpperCase(), extensions: [kind] }] })
      return choice.canceled ? undefined : choice.filePaths[0]
    }, url => shell.openExternal(url))
    protocol.handle('ling-asset', async request => {
      const url = new URL(request.url)
      const name = url.pathname.slice(1)
      if (url.hostname !== 'local' || !/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(name)) return new Response('Not found', { status: 404 })
      try {
        const bytes = await readFile(join(importer.assetsDirectory, name))
        return new Response(bytes, { headers: { 'Content-Type': `image/${name.endsWith('jpg') ? 'jpeg' : name.split('.').at(-1)}`, 'Content-Security-Policy': "default-src 'none'" } })
      } catch { return new Response('Not found', { status: 404 }) }
    })
    window = new BrowserWindow({ title: 'LingKeep', width: 1360, height: 900, minWidth: 820, minHeight: 620, backgroundColor: '#f7f8f4', webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      backgroundThrottling: process.env.LING_KEEP_SMOKE !== '1'
    } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    let permitClose = false
    let closing = false
    window.on('close', event => {
      if (permitClose || window!.webContents.isLoading() || window!.webContents.isCrashed()) return
      event.preventDefault()
      if (!closing) { closing = true; window!.webContents.send('ling:close-request') }
    })
    ipcMain.on('ling:close-ready', (event, success) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return
      closing = false
      if (success === true) { permitClose = true; window.close() }
    })
    ipcMain.handle('ling:command', async (event, command) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return { error: '无效的调用来源' }
      try { return await application.command(command) }
      catch (error) {
        const message = error instanceof Error ? error.name === 'ZodError' ? '输入数据无效，请检查后重试' : error.message : '操作失败，请重试'
        // No inputs, prompts, settings, credentials or imported content enter logs.
        console.warn('[LingKeep]', typeof command?.type === 'string' ? command.type : 'invalid', message)
        return { error: message }
      }
    })
    if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    if (process.env.LING_KEEP_SMOKE === '1') {
      try { await runSmoke(window, application, directory); console.log('LING_SMOKE_OK'); app.exit(0) }
      catch (error) {
        console.error('LING_SMOKE_FAILED', error)
        if (!window.isDestroyed()) {
          const SMOKE_SCREENSHOT_TIMEOUT_MS = 2_000
          const capture = import('node:fs/promises').then(fs => window!.webContents.capturePage().then(image => fs.writeFile(join(directory, 'failure.png'), image.toPNG()))).catch(captureError => console.warn('Smoke screenshot failed', captureError))
          await Promise.race([capture, new Promise(resolve => setTimeout(resolve, SMOKE_SCREENSHOT_TIMEOUT_MS))])
        }
        app.exit(1)
      }
    }
  }).catch(error => { console.error('LingKeep 启动失败', error instanceof Error ? error.message : 'unknown'); app.exit(1) })
  app.on('window-all-closed', () => { if (process.env.LING_KEEP_SMOKE !== '1') app.quit() })
}
