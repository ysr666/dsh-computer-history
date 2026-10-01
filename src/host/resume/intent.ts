export type ResumeSurface =
  | 'browser'
  | 'terminal'
  | 'editor'
  | 'document'

export interface ResumeIntent {
  readonly isResume: boolean
  readonly externalCue: boolean
  readonly surface?: ResumeSurface
}

const RESUME_PREFIX =
  /^(继续|接着|接着做|继续做|回到|恢复|resume\b|continue\b)/i

const RESUME_REFERENCE =
  /(继续|接着|恢复).*(刚才|之前|上次|那个|这个)|(?:刚才|之前|上次).*(继续|接着|恢复)/i

export function detectResumeIntent(query: string): ResumeIntent {
  const value = query.trim()
  const lower = value.toLowerCase()

  const isResume = RESUME_PREFIX.test(value)
    || RESUME_REFERENCE.test(value)

  const browser = /浏览器|网页|chrome|browser|page/.test(lower)
  const terminal = /终端|命令行|terminal|shell/.test(lower)
  const editor =
    /vscode|visual studio code|编辑器|code\s*里|code\s*中/.test(lower)
  const document = /preview|pdf|预览|文档/.test(lower)

  const surface = browser
    ? 'browser' as const
    : terminal
      ? 'terminal' as const
      : editor
        ? 'editor' as const
        : document
          ? 'document' as const
          : undefined

  const externalCue = surface !== undefined
    || /电脑上|电脑里|桌面上|刚才在电脑|outside.*session/i.test(value)

  return {
    isResume,
    externalCue,
    ...(surface ? { surface } : {}),
  }
}
