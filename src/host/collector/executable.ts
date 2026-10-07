import { fileURLToPath } from 'node:url'

const COLLECTOR_BY_PLATFORM: Readonly<Record<'darwin' | 'win32' | 'linux', string>> = {
  darwin: '../bin/dsh-computer-history-collector',
  win32: '../bin/dsh-computer-history-collector-windows.exe',
  linux: '../bin/dsh-computer-history-collector-linux',
}

export function resolvePackagedCollectorExecutable(
  moduleUrl: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    throw new Error(`unsupported computer-history collector platform: ${platform}`)
  }
  return fileURLToPath(new URL(COLLECTOR_BY_PLATFORM[platform], moduleUrl))
}
