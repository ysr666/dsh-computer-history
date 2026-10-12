import {test,expect} from 'vitest'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {publishVerifiedBuild,stagedBuild} from '../scripts/dev-staged-build.mjs'

const previous='window.__ModuleLoader__.load({ id: "dsh-computer-history", factory:()=>"old" })'
const replacement='window.__ModuleLoader__.load({ id: "dsh-computer-history", factory:()=>"new" })'
async function fixture(run:(ctx:{root:string,stage:string,dest:string})=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'dch-stage-test-'))
  const stage=join(root,'stage'),dest=join(root,'lib')
  await mkdir(stage,{recursive:true});await mkdir(dest,{recursive:true})
  await writeFile(join(stage,'index.js'),'new index');await writeFile(join(stage,'index.d.ts'),'index declarations')
  await writeFile(join(stage,'client.js'),replacement);await writeFile(join(stage,'client.d.ts'),'client declarations')
  await writeFile(join(stage,'build-info.json'),'{}')
  await writeFile(join(dest,'client.js'),previous);await writeFile(join(dest,'unused.js'),'old orphan')
  try{await run({root,stage,dest})}finally{await rm(root,{recursive:true,force:true})}
}

test('Client factory is atomically published last after all sibling outputs',async()=>fixture(async({stage,dest})=>{
  const updates:string[]=[]
  await publishVerifiedBuild(stage,dest,{async afterFile(name:string){
    updates.push(name)
    if(name!=='client.js')expect(await readFile(join(dest,'client.js'),'utf8')).toBe(previous)
  }})
  expect(updates.at(-1)).toBe('client.js')
  expect(await readFile(join(dest,'client.js'),'utf8')).toBe(replacement)
  await expect(readFile(join(dest,'unused.js'))).rejects.toMatchObject({code:'ENOENT'})
}))

test('malformed Client stage is rejected without modifying the running Client',async()=>fixture(async({stage,dest})=>{
  await writeFile(join(stage,'client.js'),'invalid client')
  await expect(publishVerifiedBuild(stage,dest)).rejects.toThrow(/contract/)
  expect(await readFile(join(dest,'client.js'),'utf8')).toBe(previous)
}))

test('failed tsdown build leaves prior Client and cleans stage',async()=>fixture(async({root,dest})=>{
  await expect(stagedBuild(root,async()=>{throw Error('synthetic failed build')})).rejects.toThrow(/synthetic failed build/)
  expect(await readFile(join(dest,'client.js'),'utf8')).toBe(previous)
}))
