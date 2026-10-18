import { expect, test } from 'vitest'
import { publicURL } from '../src/main/network'
test('web import rejects local addresses, unsafe schemes and embedded credentials', async () => {
  for (const url of ['http://127.0.0.1/x', 'http://[::1]/', 'http://192.168.1.1/', 'file:///tmp/a', 'https://name:password@example.com/']) await expect(publicURL(url)).rejects.toThrow()
})
