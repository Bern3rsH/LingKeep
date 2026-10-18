import { mkdir, readFile, open, rename, copyFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emptyState, stateSchema, type State } from '../shared/domain'

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

export class Store {
  private queue: Promise<unknown> = Promise.resolve()
  private recoveryNotice: string | undefined
  constructor(readonly path: string) {}
  takeRecoveryNotice(): string | undefined { const notice = this.recoveryNotice; this.recoveryNotice = undefined; return notice }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }
  private async load(): Promise<State> {
    let bytes: string
    try { bytes = await readFile(this.path, 'utf8') }
    catch (error) { if (missing(error)) {
      try {
        const recovered = stateSchema.parse(JSON.parse(await readFile(`${this.path}.bak`, 'utf8')))
        await this.write(recovered, false)
        this.recoveryNotice = '主数据文件缺失，已恢复上一次有效备份，请核对最近保存的内容。'
        return recovered
      }
      catch (backupError) { if (missing(backupError)) return emptyState(); throw new Error('主数据缺失且备份无法读取，请保留数据文件。') }
    } throw error }
    try { return stateSchema.parse(JSON.parse(bytes)) }
    catch {
      await copyFile(this.path, `${this.path}.corrupt-${Date.now()}-${randomUUID()}`)
      try {
        const recovered = stateSchema.parse(JSON.parse(await readFile(`${this.path}.bak`, 'utf8')))
        await this.write(recovered, false)
        this.recoveryNotice = '本地数据损坏，已保留原文件并恢复上一次有效备份，请核对最近保存的内容。'
        return recovered
      } catch { throw new Error('本地数据损坏且无有效备份；已保留原文件，未重置数据。') }
    }
  }
  private async write(state: State, backup: boolean): Promise<void> {
    stateSchema.parse(state)
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync() } finally { await handle.close() }
      if (backup) { try { await copyFile(this.path, `${this.path}.bak`) } catch (error) { if (!missing(error)) throw error } }
      await rename(temporary, this.path)
    } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error }) }
  }
  read(): Promise<State> { return this.serialize(() => this.load()) }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const state = await this.load()
      const result = await change(state)
      await this.write(state, true)
      return result
    })
  }
}
