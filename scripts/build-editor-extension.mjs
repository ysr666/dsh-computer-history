#!/usr/bin/env node
// Packages the editor companion as a .vsix: a zip with the manifest and the
// compiled output, plus the [Content_Types].xml every VSIX carries. No new
// dependency: the repository already has zip on the machines it runs on, and a
// hand-rolled packer is easier to audit than a packaging framework.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const pkgDir = path.join(root, 'extension-editor')
const stage = path.join(root, '.vsix-stage')
const out = path.join(root, 'dsh-computer-history-editor.vsix')

execFileSync('pnpm', ['exec', 'tsc', '-p', pkgDir], { cwd: root, stdio: 'inherit' })

rmSync(stage, { recursive: true, force: true })
mkdirSync(path.join(stage, 'extension'), { recursive: true })
cpSync(path.join(pkgDir, 'package.json'), path.join(stage, 'extension', 'package.json'))
cpSync(path.join(pkgDir, 'out'), path.join(stage, 'extension', 'out'), { recursive: true })
writeFileSync(
  path.join(stage, '[Content_Types].xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>`,
)
writeFileSync(
  path.join(stage, 'extension.vsixmanifest'),
  `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="dsh-computer-history-editor" Version="0.1.0" Publisher="dsh-local"/>
    <DisplayName>DSH Computer History (editor companion)</DisplayName>
    <Description xml:space="preserve">Tells the local DeepSeek Harness where work is happening: the workspace root and the active file, nothing else.</Description>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json"/></Assets>
</PackageManifest>`,
)

rmSync(out, { force: true })
execFileSync('zip', ['-q', '-r', '-X', out, '.', '-x', '.DS_Store'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })
console.log('built', path.relative(root, out), existsSync(out) ? '' : '(MISSING)')
