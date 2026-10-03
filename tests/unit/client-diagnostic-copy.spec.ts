import {
  readFileSync,
} from 'node:fs'
import {
  describe,
  expect,
  it,
} from 'vitest'

// The reader must never be shown a diagnostic. `Failed to fetch` is a browser message, `capture-owned-by-
// another-host` is a Host reason code, and "Worked in /alpha." is a sentence the Host generated for storage -
// none of them are copy, and all three have reached the interface in this repository's history.
//
// This is a source guard rather than a rendering test on purpose. The failure mode is not "the mapping is
// wrong" (the mapping has unit tests); it is "a render path forgot to map", which shipped twice: once in the
// settings view and once in the panel's alert, both rendering `store.error` directly. A guard that reads the
// two views and fails when a raw diagnostic is rendered catches the next one at the line, without a browser.
const VIEWS = [
  'src/client/panel.ts',
  'src/client/settings-view.ts',
  'src/client/settings-rows.ts',
]

const source = (path: string): string => readFileSync(path, 'utf8')

describe('no view renders a raw diagnostic as copy', () => {
  it('maps every error it displays, at the render site or where the value is produced', () => {
    // Both shapes are legitimate: a value rendered straight from the store is mapped at the render site, while a
    // local piece of state is mapped where it is set (`setActionError(failureText(t, cause))`). The first version
    // of this guard only accepted the first and flagged the second, which is a false positive - and a guard that
    // cries wolf gets deleted, so it checks the assignment instead.
    const offenders: string[] = []
    for (const view of VIEWS) {
      const text = source(view)
      for (const line of text.split('\n')) {
        if (/\{(?:snapshot|controls)\.error\}/.test(line) && !line.includes('failureText')) {
          offenders.push(`${view}: rendered unmapped - ${line.trim()}`)
        }
        const rendered = /React\.createElement\([^)]*role: 'alert'[^)]*\),\s*([a-zA-Z][a-zA-Z0-9]*)\)/.exec(line)
        const variable = rendered?.[1]
        if (variable !== undefined && !line.includes('failureText')) {
          const setter = `set${variable.charAt(0).toUpperCase()}${variable.slice(1)}(`
          const assignments = text.split('\n').filter(candidate => candidate.includes(setter))
          for (const assignment of assignments) {
            if (!assignment.includes('failureText')) {
              offenders.push(`${view}: ${variable} set without the mapping - ${assignment.trim()}`)
            }
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not carry a Host-generated sentence into the interface', () => {
    // The Host stores these as prose for search and for the store's own readers; the interface renders the
    // structured fields through the locale dictionary instead.
    const hostProse = [
      'Worked in ',
      'Recent computer activity',
      'touching ',
    ]
    const offenders: string[] = []
    for (const view of VIEWS) {
      const text = source(view)
      for (const phrase of hostProse) {
        if (text.includes(phrase)) offenders.push(`${view}: ${phrase}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not carry the intake reason codes into the interface', () => {
    // `reasonText` maps the known codes; a literal code in a view means one path bypassed it.
    const codes = [
      'capture-owned-by-another-host',
      'computer history capture is disabled',
      'computer history capture is unavailable on this DSH Host',
    ]
    const offenders: string[] = []
    for (const view of VIEWS) {
      const text = source(view)
      for (const code of codes) {
        // The locale module owns these strings; a view must not spell them out.
        if (text.includes(code)) offenders.push(`${view}: ${code}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
