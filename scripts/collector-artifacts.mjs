#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')

export const COLLECTOR_ARTIFACT_SCHEMA =
  'dsh-computer-history/collector-artifact/v1'
export const COLLECTOR_MANIFEST_SCHEMA =
  'dsh-computer-history/collector-manifest/v1'

export const COLLECTOR_ARTIFACTS = Object.freeze({
  darwin: Object.freeze({
    filename: 'dsh-computer-history-collector',
    runner: 'macos-14',
  }),
  win32: Object.freeze({
    filename: 'dsh-computer-history-collector-windows.exe',
    runner: 'windows-latest',
  }),
  linux: Object.freeze({
    filename: 'dsh-computer-history-collector-linux',
    runner: 'ubuntu-latest',
  }),
})

function sourceCommit() {
  const supplied = process.env.GITHUB_SHA?.trim()
  if (supplied) return supplied
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO,
    encoding: 'utf8',
  }).trim()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function requirePlatform(platform) {
  const descriptor = COLLECTOR_ARTIFACTS[platform]
  if (!descriptor) {
    throw new Error(
      `unsupported collector artifact platform: ${platform}`,
    )
  }
  return descriptor
}

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`${label} is missing: ${file}`)
  }
}

function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${label} is not a full git commit SHA: ${value}`)
  }
}

function makeExecutable(file, platform) {
  if (platform !== 'win32') chmodSync(file, 0o755)
}

export function emitCollectorArtifact({
  platform,
  source,
  outputDirectory,
  commit = sourceCommit(),
  runnerOs = process.env.RUNNER_OS ?? 'unknown',
  runnerArch = process.env.RUNNER_ARCH ?? process.arch,
}) {
  const descriptor = requirePlatform(platform)
  requireSha(commit, 'collector source commit')
  requireFile(source, `${platform} collector source`)
  mkdirSync(outputDirectory, { recursive: true })
  const binary = path.join(outputDirectory, descriptor.filename)
  copyFileSync(source, binary)
  makeExecutable(binary, platform)
  const provenance = {
    schema: COLLECTOR_ARTIFACT_SCHEMA,
    platform,
    sourceCommit: commit,
    runner: descriptor.runner,
    runnerOs,
    runnerArch,
    file: descriptor.filename,
    sha256: sha256(binary),
  }
  writeFileSync(
    path.join(outputDirectory, `provenance-${platform}.json`),
    JSON.stringify(provenance, null, 2) + '\n',
  )
  return provenance
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${file}: ${error}`)
  }
}

export function assembleCollectorArtifacts({
  inputDirectory,
  packageRoot = REPO,
  commit = sourceCommit(),
}) {
  requireSha(commit, 'release source commit')
  const bin = path.join(packageRoot, 'bin')
  mkdirSync(bin, { recursive: true })
  const collectors = {}

  for (const [platform, descriptor] of Object.entries(COLLECTOR_ARTIFACTS)) {
    const provenanceFile = path.join(
      inputDirectory,
      `provenance-${platform}.json`,
    )
    const provenance = readJson(
      provenanceFile,
      `${platform} collector provenance`,
    )
    if (provenance.schema !== COLLECTOR_ARTIFACT_SCHEMA) {
      throw new Error(
        `${platform} provenance schema is ${provenance.schema ?? '<missing>'}`,
      )
    }
    if (provenance.platform !== platform) {
      throw new Error(
        `${platform} provenance claims platform ${provenance.platform}`,
      )
    }
    if (provenance.file !== descriptor.filename) {
      throw new Error(
        `${platform} provenance file is ${provenance.file}, expected ${descriptor.filename}`,
      )
    }
    if (provenance.sourceCommit !== commit) {
      throw new Error(
        `${platform} collector came from ${provenance.sourceCommit}, release is ${commit}`,
      )
    }
    if (provenance.runner !== descriptor.runner) {
      throw new Error(
        `${platform} collector claims runner ${provenance.runner}, expected ${descriptor.runner}`,
      )
    }

    const sourceBinary = path.join(inputDirectory, descriptor.filename)
    requireFile(sourceBinary, `${platform} downloaded collector`)
    const actual = sha256(sourceBinary)
    if (actual !== provenance.sha256) {
      throw new Error(
        `${platform} collector hash changed in artifact transfer: ${actual} != ${provenance.sha256}`,
      )
    }

    const destination = path.join(bin, descriptor.filename)
    copyFileSync(sourceBinary, destination)
    makeExecutable(destination, platform)
    collectors[platform] = {
      path: `bin/${descriptor.filename}`,
      sha256: actual,
      runner: provenance.runner,
      runnerOs: provenance.runnerOs,
      runnerArch: provenance.runnerArch,
    }
  }

  const manifest = {
    schema: COLLECTOR_MANIFEST_SCHEMA,
    sourceCommit: commit,
    collectors,
  }
  writeFileSync(
    path.join(bin, 'collector-artifacts.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  return manifest
}

export function verifyCollectorArtifacts(
  packageRoot = REPO,
  expectedCommit,
) {
  const manifestFile = path.join(
    packageRoot,
    'bin',
    'collector-artifacts.json',
  )
  const manifest = readJson(manifestFile, 'collector manifest')
  if (manifest.schema !== COLLECTOR_MANIFEST_SCHEMA) {
    throw new Error(
      `collector manifest schema is ${manifest.schema ?? '<missing>'}`,
    )
  }
  requireSha(manifest.sourceCommit, 'collector manifest source commit')
  if (
    expectedCommit
    && manifest.sourceCommit !== expectedCommit
  ) {
    throw new Error(
      `collector manifest came from ${manifest.sourceCommit}, expected ${expectedCommit}`,
    )
  }

  const actualPlatforms = Object.keys(manifest.collectors ?? {}).sort()
  const expectedPlatforms = Object.keys(COLLECTOR_ARTIFACTS).sort()
  if (JSON.stringify(actualPlatforms) !== JSON.stringify(expectedPlatforms)) {
    throw new Error(
      `collector manifest platforms are [${actualPlatforms.join(', ')}], expected [${expectedPlatforms.join(', ')}]`,
    )
  }

  for (const [platform, descriptor] of Object.entries(COLLECTOR_ARTIFACTS)) {
    const entry = manifest.collectors[platform]
    const expectedPath = `bin/${descriptor.filename}`
    if (entry.path !== expectedPath) {
      throw new Error(
        `${platform} collector manifest path is ${entry.path}, expected ${expectedPath}`,
      )
    }
    if (entry.runner !== descriptor.runner) {
      throw new Error(
        `${platform} collector manifest runner is ${entry.runner}, expected ${descriptor.runner}`,
      )
    }
    const binary = path.join(packageRoot, expectedPath)
    requireFile(binary, `${platform} packaged collector`)
    const actual = sha256(binary)
    if (actual !== entry.sha256) {
      throw new Error(
        `${platform} packaged collector hash is ${actual}, manifest says ${entry.sha256}`,
      )
    }
    if (
      platform !== 'win32'
      && process.platform !== 'win32'
      && (statSync(binary).mode & 0o111) === 0
    ) {
      throw new Error(
        `${platform} packaged collector is not executable: ${binary}`,
      )
    }
  }

  return manifest
}

function usage() {
  console.error(
    'usage:\n'
    + '  node scripts/collector-artifacts.mjs emit <darwin|win32|linux> <source-binary> <out-dir> [commit]\n'
    + '  node scripts/collector-artifacts.mjs assemble <download-dir> [package-root] [commit]\n'
    + '  node scripts/collector-artifacts.mjs verify [package-root] [expected-commit]',
  )
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)

if (invoked) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'emit') {
      const [platform, source, outputDirectory, commit] = args
      if (!platform || !source || !outputDirectory) {
        usage()
        process.exit(2)
      }
      const provenance = emitCollectorArtifact({
        platform,
        source: path.resolve(source),
        outputDirectory: path.resolve(outputDirectory),
        ...(commit ? { commit } : {}),
      })
      console.log(JSON.stringify(provenance, null, 2))
    } else if (command === 'assemble') {
      const [inputDirectory, root, commit] = args
      if (!inputDirectory) {
        usage()
        process.exit(2)
      }
      const manifest = assembleCollectorArtifacts({
        inputDirectory: path.resolve(inputDirectory),
        packageRoot: root ? path.resolve(root) : REPO,
        ...(commit ? { commit } : {}),
      })
      console.log(JSON.stringify(manifest, null, 2))
    } else if (command === 'verify') {
      const [root, expectedCommit] = args
      const manifest = verifyCollectorArtifacts(
        root ? path.resolve(root) : REPO,
        expectedCommit,
      )
      console.log(JSON.stringify(manifest, null, 2))
    } else {
      usage()
      process.exit(2)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
