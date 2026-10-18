import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024
const REQUEST_TIMEOUT = 45_000
const MAX_REDIRECTS = 5
function isPrivate(address: string): boolean {
  const lower = address.toLowerCase()
  if (isIP(address) === 6) return lower === '::' || lower === '::1' || /^(fc|fd|fe[89ab])/.test(lower) || lower.includes('ffff:')
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224 || a === 100 && b >= 64 && b <= 127
}
async function resolvePublic(value: string) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含凭据的 HTTP(S) 网址')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(item => isPrivate(item.address))) throw new Error('不支持导入本机或内网网址')
  return { url, address: addresses[0] }
}
export async function publicURL(value: string): Promise<URL> { return (await resolvePublic(value)).url }

export async function download(value: string, limit = MAX_DOWNLOAD_BYTES): Promise<{ bytes: Buffer; url: string; contentType: string }> {
  let location = value
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const { url, address } = await resolvePublic(location)
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest
      // Pin the validated address so DNS cannot change the destination into a private network.
      const connection = request(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        headers: { 'User-Agent': 'LingKeep/0.1 article importer', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family)
      }, resolve)
      connection.on('error', () => reject(new Error('网页连接失败或超时，请检查网址和网络后重试')))
      connection.end()
    })
    const status = response.statusCode || 0
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.resume()
      if (!response.headers.location) throw new Error('网页重定向缺少目标地址')
      location = new URL(response.headers.location, url).href
      continue
    }
    if (status < 200 || status >= 300) { response.resume(); throw new Error(`下载失败（HTTP ${status}）`) }
    if (Number(response.headers['content-length'] || 0) > limit) { response.destroy(); throw new Error('文件超过大小限制') }
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > limit) { response.destroy(); throw new Error('文件超过大小限制') }
      chunks.push(buffer)
    }
    let bytes = Buffer.concat(chunks)
    const encoding = response.headers['content-encoding']
    const options = { maxOutputLength: limit }
    if (encoding === 'gzip') bytes = gunzipSync(bytes, options)
    else if (encoding === 'deflate') bytes = inflateSync(bytes, options)
    else if (encoding === 'br') bytes = brotliDecompressSync(bytes, options)
    return { bytes, url: url.href, contentType: String(response.headers['content-type'] || '') }
  }
  throw new Error('网页重定向次数过多')
}
