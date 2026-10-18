import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const executable = process.argv[2]
assert(executable, 'Usage: npm run smoke:package -- <packaged executable>')
const directory = await mkdtemp(join(tmpdir(), 'ling-keep-package-'))
const env = { ...process.env, LING_KEEP_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
delete env.LING_KEEP_SMOKE
const child = spawn(executable, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', socket, requestId = 0
const pending = new Map()
child.stdout.on('data', chunk => { output += chunk })
child.stderr.on('data', chunk => { output += chunk })
const timeout = setTimeout(() => { console.error('Packaged app timed out', output); child.kill(); process.exitCode = 1 }, 90_000)
try {
  let port
  for (let attempt = 0; attempt < 300; attempt++) {
    try { port = Number((await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch {}
    assert(child.exitCode === null, `Packaged app exited before startup: ${output}`)
    await delay(100)
  }
  assert(port, `No packaged renderer debugging endpoint: ${output}`)
  let page
  for (let attempt = 0; attempt < 150; attempt++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page')
    if (page) break
    await delay(100)
  }
  assert(page, 'No renderer page')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
  }
  async function evaluate(expression) {
    const id = ++requestId
    const result = new Promise(resolve => pending.set(id, resolve))
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const message = await result
    assert(!message.error && !message.result.exceptionDetails, JSON.stringify(message))
    return message.result.result.value
  }
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate('Boolean(window.ling && document.querySelector(".onboarding"))')) break
    await delay(100)
  }
  assert.equal(await evaluate('typeof window.require'), 'undefined')
  const result = await evaluate(`(async()=>{
    const invoke=async command=>{const result=await window.ling.invoke(command);if(result.error)throw Error(result.error);return result};
    const fresh=await invoke({type:'snapshot'});if(fresh.snapshot.activeProfile!==null)throw Error('Not isolated');
    await invoke({type:'profile',profile:'zh-en'});
    const preview=await invoke({type:'preview',profile:'zh-en',kind:'text',title:'Release smoke',input:'A bank by the river.'});
    const material=preview.material;
    await invoke({type:'import',profile:'zh-en',previewId:preview.duplicateId,title:material.title,blockIds:material.chapters.flatMap(chapter=>chapter.blocks.map(block=>block.id)),copy:false});
    const selection={materialId:material.id,chapterId:material.chapters[0].id,blockId:material.chapters[0].blocks[0].id,spans:[{start:2,end:6}],combined:false,text:'bank',context:'A bank by the river.'};
    const lookup=await invoke({type:'lookup',profile:'zh-en',selection});
    if(!lookup.meanings.some(meaning=>meaning.text.includes('银行')))throw Error('Packaged dictionary unavailable');
    await invoke({type:'selectMeaning',profile:'zh-en',selection,meaning:lookup.meanings[0]});
    const snapshot=(await invoke({type:'snapshot'})).snapshot;
    if(snapshot.profile.keeps.length!==1||snapshot.profile.keeps[0].level!==1)throw Error('Keep not saved');
    return true;
  })()`)
  assert.equal(result, true)
  socket.send(JSON.stringify({ id: ++requestId, method: 'Page.reload' }))
  let restored = false
  for (let attempt = 0; attempt < 150; attempt++) {
    await delay(100)
    try { restored = await evaluate('Boolean(window.ling && document.querySelector(".material-card"))') } catch {}
    if (restored) break
  }
  assert(restored, `Packaged Library did not restore: ${await evaluate('document.body.innerText')}`)
  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
  assert.equal(state.profiles['zh-en'].keeps.length, 1)
  console.log('PACKAGED_SMOKE_OK: startup, sandbox/preload, offline dictionary, import, Keep, reload and persistence')
} finally {
  clearTimeout(timeout)
  socket?.close()
  child.kill()
  console.log(`Isolated packaged smoke data: ${directory}`)
}
