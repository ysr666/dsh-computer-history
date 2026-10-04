import { describe, expect, it } from 'vitest'
import { appliesPosixModes } from '../../src/host/store/database.js'

/**
 * The store hardens its directory to 0700 and its files to 0600, then asserts the modes it read back.
 * That assertion is a POSIX idea: on Windows Node synthesises the mode (0666 for a writable file, 0777
 * for a writable directory) and `chmod` only toggles the read-only attribute, so "no broader than 0600"
 * would refuse to open the store at all - the Host would not start, and no collector could run.
 *
 * The platform cannot be switched inside a test, so the decision is a function and this is its guard:
 * the Windows Host row depends on it returning false there, and on it staying true everywhere the
 * assertion is what protects the store. The machine-side confirmation of the synthetic mode is
 * `node -e "console.log(require('node:fs').statSync(process.env.USERPROFILE).mode.toString(8))"`.
 */
describe('store permission hardening', () => {
  it('applies the POSIX mode checks everywhere but Windows', () => {
    expect(appliesPosixModes('darwin')).toBe(true)
    expect(appliesPosixModes('linux')).toBe(true)
    expect(appliesPosixModes('win32')).toBe(false)
  })
})
