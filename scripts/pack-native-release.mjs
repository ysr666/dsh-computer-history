import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outputDirectory = path.resolve(process.argv[2] ?? 'package-out')
const executableFiles = [
  'bin/dsh-computer-history-collector',
  'bin/dsh-computer-history-collector-linux',
]
const requiredFiles = [
  ...executableFiles,
  'bin/dsh-computer-history-collector-windows.exe',
  'bin/native-artifacts.json',
]

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`cannot pack release: staged file is missing: ${file}`)
  }
}

mkdirSync(outputDirectory, { recursive: true })
const scratch = mkdtempSync(path.join(os.tmpdir(), 'dsh-native-pack-'))

try {
  const initial = path.join(scratch, 'initial')
  const unpacked = path.join(scratch, 'unpacked')
  const verified = path.join(scratch, 'verified')
  mkdirSync(initial)
  mkdirSync(unpacked)
  mkdirSync(verified)

  // pnpm/npm pack deliberately normalizes ordinary package files to 0644.
  // Native POSIX collectors are not public npm CLI bins, so pack them normally
  // first, then restore only the two executable payload modes in the final tgz.
  execFileSync(
    'pnpm',
    ['pack', '--pack-destination', initial],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DSH_NATIVE_PREBUILT: '1',
      },
    },
  )

  const tarballs = readdirSync(initial).filter(name => name.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`expected exactly one packed tgz, found ${tarballs.length}`)
  }
  const name = tarballs[0]
  const source = path.join(initial, name)
  execFileSync('tar', ['-xzf', source, '-C', unpacked])

  for (const file of executableFiles) {
    const target = path.join(unpacked, 'package', file)
    if (!existsSync(target)) {
      throw new Error(`packed release is missing ${file}`)
    }
    chmodSync(target, 0o755)
  }

  const output = path.join(outputDirectory, name)
  execFileSync('tar', ['-czf', output, '-C', unpacked, 'package'])

  // Prove the mode survived the archive rewrite, rather than assuming chmod on
  // the temporary tree means the uploaded tgz is executable after extraction.
  execFileSync('tar', ['-xzf', output, '-C', verified, 'package/bin'])
  for (const file of executableFiles) {
    const mode = statSync(path.join(verified, 'package', file)).mode & 0o777
    if ((mode & 0o111) === 0) {
      throw new Error(`${file} is not executable in the final tgz (mode ${mode.toString(8)})`)
    }
  }

  // Windows does not consume POSIX execute bits, but its exact bytes and all
  // three SHA-256 values remain covered by native-artifacts.json.
  console.log(
    `packed three-platform release with executable native payloads: ${output}`,
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
