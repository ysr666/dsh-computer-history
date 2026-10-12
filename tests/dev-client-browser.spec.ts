import { test } from 'vitest'
import assert from 'node:assert/strict'
import { openDevBrowser, validateDevBrowserOptions } from '../scripts/dev-client-browser.mjs'
const base = {
  url: 'http://127.0.0.1:1234/?token=DO_NOT_PRINT',
  chromeBin: '/private/test/chrome',
  puppeteerEntry: '/private/test/puppeteer-core.js',
}

test('dev browser rejects remote, mixed, authenticated-authority and non-HTTP URLs', () => {
  for (const url of [
    'https://127.0.0.1/', 'http://8.8.8.8/', 'http://localhost.example.com/',
    'http://user:pass@127.0.0.1/', 'file:///tmp/index.html', 'http://0.0.0.0/',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => validateDevBrowserOptions({ ...base, url }), /loopback URL/)
  }
  assert.equal(validateDevBrowserOptions(base).url, base.url)
  assert.equal(validateDevBrowserOptions({...base,url:'http://[::1]:1234/'}).url,
    'http://[::1]:1234/')
  assert.throws(() => validateDevBrowserOptions({...base, chromeBin:'chrome'}), /absolute Chrome/)
  assert.throws(() => validateDevBrowserOptions({...base,puppeteerEntry:'./puppeteer'}), /absolute Chrome/)
})

test('CDP via private pipe; one isolated page is opened and reloaded without leaking URL', async () => {
  const calls: string[] = []
  let launches: Record<string, any>[] = []
  const page = {
    async goto(url: string) {
      assert.equal(url, base.url)
      calls.push('goto')
      return {status:()=>200}
    },
    isClosed:()=>false,
    async reload() {
      calls.push('reload')
      return {status:()=>200}
    },
  }
  const browser = {
    newPage: async()=>page,
    close:async()=>{calls.push('close')},
  }
  const handle = await openDevBrowser(base, {
    loadPuppeteer: async()=>({launch:async(settings: Record<string, any>)=>{
      launches.push(settings)
      return browser
    }}),
  })
  await handle.reload()
  await handle.close()
  await handle.close()
  assert.deepEqual(calls,['goto','reload','close'])
  assert.equal(launches.length,1)
  assert.equal(launches[0]?.pipe,true)
  assert.equal(launches[0]?.headless,false)
  assert.equal(launches[0]?.executablePath,base.chromeBin)
  await assert.rejects(handle.reload(),/closed/)
})

test('initial navigation error closes its private Chrome instance',async()=>{
  let closed=0
  await assert.rejects(openDevBrowser(base,{
    loadPuppeteer:async()=>({launch:async()=>({
      newPage:async()=>({goto:async()=>({status:()=>404})}),
      close:async()=>{closed++},
    })}),
  }),/HTTP 404/)
  assert.equal(closed,1)
})

test('reload failures report HTTP errors and do not prevent safe cleanup',async()=>{
  let closed=0
  const handle=await openDevBrowser(base,{
    loadPuppeteer:async()=>({launch:async()=>({
      newPage:async()=>({
        goto:async()=>({status:()=>200}),
        isClosed:()=>false,
        reload:async()=>({status:()=>503}),
      }),
      close:async()=>{closed++},
    })}),
  })
  await assert.rejects(handle.reload(),/HTTP 503/)
  await handle.close()
  assert.equal(closed,1)
})
