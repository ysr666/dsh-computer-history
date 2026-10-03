import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export const HISTORY_LOCALE_NS = 'computer-history' as const

const enCore = {
  title: 'Computer History',
  subtitle: 'What this machine has been used for, kept locally.',
  subtitleProduct: 'What this machine has been used for — applications, files and time only.',
  loadingSettings: 'Loading Computer History settings…',
  retry: 'Retry',
  loadFailed: 'Could not reach the Host.',
  episodeResources: 'Files: {resources}',
  episodeApps: 'Apps: {apps}',
  episodeNoEvidence: 'No file or application was visible',
  andMore: ' and {count} more',
  unnamedWorkspace: 'an unnamed workspace',
  reasonCaptureOwnedByAnotherHost: 'Another DSH Host is already recording on this machine.',
  reasonCaptureDisabled: 'Recording is switched off in the Host configuration.',
  reasonCaptureUnavailable: 'Recording is not available on this Host.',
  reasonPolicyOwnedByAnotherHost: 'Application rules are owned by another DSH Host.',

  captureRunning: 'recording',
  capturePaused: 'paused',
  captureStopped: 'stopped',
  captureDegraded: 'having trouble',
  capturePermission: 'needs permission',
  accessibilityGranted: 'granted',
  accessibilityRequired: 'required',
  underMinute: 'under a minute',
  minutes: '{minutes} min',
  durationHours: '{hours} h',
  durationHoursMinutes: '{hours} h {minutes} min',
  today: 'Today',
  yesterday: 'Yesterday',
  daySummary: '{duration} · {count} episodes',
  metadataOnly: 'Metadata only',
  todayUsage: 'Today {duration} · {apps} apps',
  todayUsageNone: 'No activity recorded today',
  staleRelease: 'The installed copy is older than the one you built (profile: {profile}).',
  staleRunCommand: 'Run this, then restart the Host:',
  startHere: 'Start here',
  firstRunIntro: 'Nothing is recorded yet. Computer History records only applications you allow, and only metadata — which application, which file, for how long.',
  firstRunPrivacy: 'It never records screen contents, document text, selections, or what you type. Password managers are always protected.',
  startRecording: 'Start recording',
  timeline: 'Timeline',
  timelineLoading: 'Loading timeline…',
  timelineEmpty: 'Nothing recorded in the last seven days yet.',
  timelineUnavailable: 'Timeline is unavailable right now.',
  timelineDayOne: '{day} · 1 episode',
  timelineDayMany: '{day} · {count} episodes',
  whyRecorded: 'Why was this recorded?',
  resources: 'Resources: {resources}',
  noResourceApps: 'No resource was visible. Applications: {apps}',
} as const

const enPanel = {
  summaries: 'Summaries',
  summaryRemote: 'Deterministic summaries are on. At least one scope uses a remote model with a minimised metadata-only payload; paths, URLs and document names are not sent.',
  summaryLocal: 'Summaries stay on this machine. Local model: {status}.',
  configured: 'configured',
  notConfigured: 'not configured',
  summaryLoading: 'Loading summary state…',
  summaryUnavailable: 'Summary state is unavailable right now.',
  summaryRemoteShort: 'Remote summary enabled',
  summaryLocalShort: 'Local summary',
  previewPayload: 'Preview payload',
  turnOffPurge: 'Turn off and purge',
  noModelScope: 'No scope uses a model.',
  resumeHit: 'Resume “{title}” — open {resource} ({citations} citations, confidence {confidence}).',
  resumeAmbiguous: 'More than one candidate: {reason}',
  resumeNone: 'Nothing to resume: {reason}',
  resume: 'Resume',
  lastActivity: 'the last activity',
  resumeAria: 'Describe the work to resume',
  resumePlaceholder: 'e.g. continue the billing work',
  resumeFind: 'Find where I left off',
  resumeRecentMeta: '{app} · {duration}',
  workThreads: 'Work threads',
  workThreadsLoading: 'Loading work threads…',
  workThreadsUnavailable: 'Work threads are unavailable right now.',
  workThreadsEmpty: 'No threaded work yet: episodes need a workspace the Host can vouch for.',
  workThreadMetaOne: ' · 1 episode · {citations} citations',
  workThreadMetaMany: ' · {episodes} episodes · {citations} citations',
  threadMeta: '{episodes} episodes · {duration}',
  statusLine: 'Capture: {capture} · Accessibility: {accessibility} · retention: {hours}h',
  stateUnavailable: 'Computer History state is unavailable.',
  loadingHistory: 'Loading Computer History…',
  statusDetail: 'Status detail: {reason}',
} as const

export const enSettings = {
  recordingTitle: 'Recording',
  pausedFeedback: 'Paused.',
  recordingFeedback: 'Recording.',
  recordingOnDescription: 'This machine is being recorded. Only what you allow, and only metadata.',
  recordingOffDescription: 'Not recording right now. Nothing new is being written.',
  recordingOnDescriptionShort: 'Applications, websites and files you allow are being recorded as metadata.',
  recordingOffDescriptionShort: 'New activity is not being recorded right now.',
  settingOn: 'On',
  settingPaused: 'Paused',
  settingUnavailable: 'Unavailable',
  pauseRecording: 'Pause recording',
  recordingUnavailable: 'Recording unavailable',
  whyReason: 'Why: {reason}',
  appAllowedFeedback: 'Application allowed.',
  appForgottenFeedback: 'Application forgotten.',
  applicationsTitle: 'Applications and sites that take part',
  applicationsDescriptionShort: 'Choose which applications and websites can appear in history.',
  applicationsValue: '{count} allowed',
  applicationsSummary: 'Allowed: {allowed}. Denied: {denied}. Password managers stay protected whatever this says.',
  applicationsNone: 'Nothing is allowed yet, so nothing is recorded.',
  forget: 'Forget',
  bundleIdAria: 'Application bundle id',
  bundleIdPlaceholder: 'e.g. com.apple.Safari',
  allowApp: 'Allow app',
} as const

const enSettingsMore = {
  retentionValidation: 'Use whole numbers: observations {observationMin}–{observationMax} hours; episodes {episodeMin}–{episodeMax} days.',
  saved: 'Saved.',
  retentionTitle: 'How long history is kept',
  retentionDescription: 'Raw observations and the episodes built from them. A change applies from now on; it does not delete what you already have.',
  retentionDescriptionShort: 'Choose how long Computer History keeps your data.',
  retentionValue: '{days} days',
  observationsHours: 'Observations (hours)',
  episodesDays: 'Episodes (days)',
  save: 'Save',
  historyDeleted: 'History deleted.',
  deleteTitle: 'Delete history',
  deleteDescription: 'Deleting removes the observations and episodes it covers. This cannot be undone.',
  deleteDescriptionShort: 'Remove recorded Computer History data.',
  confirmDeleteAll: 'Yes, delete everything',
  cancel: 'Cancel',
  deleteAll: 'Delete all history…',
  pairingCreated: 'New pairing token created.',
  companionTitle: 'Browser companion',
  companionDescriptionShort: 'Connect the browser extension for web activity metadata.',
  companionConnected: 'Connected',
  companionWaiting: 'Waiting to pair',
  companionUnavailableShort: 'Unavailable',
  companionListeningPaired: 'Listening on 127.0.0.1:{port}, paired.',
  companionListeningUnpaired: 'Listening on 127.0.0.1:{port}, not paired yet.',
  companionUnavailable: 'The companion listener is unavailable on this Host.',
  companionDescription: 'Pages are recorded only through the paired extension: Accessibility cannot tell a private window from an ordinary one.',
  createPairingToken: 'Create pairing token',
  aboutTitle: 'About',
  aboutDescriptionShort: 'Version, privacy and collector status.',
  aboutState: 'Capture: {capture} · Accessibility: {accessibility} · collector {collector}',
  stateUnavailableRow: 'State unavailable.',
  privacyLocal: 'It never records screen contents, document text, selections, or what you type. Everything stays on this machine.',
} as const

export const en = {
  ...enCore,
  ...enPanel,
  ...enSettings,
  ...enSettingsMore,
} as const

export type HistoryLocaleKey = keyof typeof en

export const zh: Record<HistoryLocaleKey, string> = {
  title: '电脑使用记录',
  subtitle: '这台电脑被用来做了什么，只保存在本机。',
  subtitleProduct: '这台电脑最近被用来做了什么，只记录应用、文件与时长。',
  loadingSettings: '正在加载电脑使用记录设置…',
  retry: '重试',
  loadFailed: '无法连接到宿主。',
  episodeResources: '文件：{resources}',
  episodeApps: '应用：{apps}',
  episodeNoEvidence: '没有可见的文件或应用',
  andMore: ' 等 {count} 项',
  unnamedWorkspace: '未命名的工作区',
  reasonCaptureOwnedByAnotherHost: '这台机器上已有另一个 DSH 宿主在采集，这里不会重复记录。',
  reasonCaptureDisabled: '宿主配置里已关闭采集。',
  reasonCaptureUnavailable: '这台宿主上无法采集。',
  reasonPolicyOwnedByAnotherHost: '应用规则由另一个 DSH 宿主掌管。',

  captureRunning: '正在采集',
  capturePaused: '已暂停',
  captureStopped: '已停止',
  captureDegraded: '运行不稳定',
  capturePermission: '需要授权',
  accessibilityGranted: '已授权',
  accessibilityRequired: '未授权',
  underMinute: '不到一分钟',
  minutes: '{minutes} 分钟',
  durationHours: '{hours} 小时',
  durationHoursMinutes: '{hours} 小时 {minutes} 分钟',
  today: '今天',
  yesterday: '昨天',
  daySummary: '{duration} · {count} 个片段',
  metadataOnly: '仅记录元数据',
  todayUsage: '今天 {duration} · {apps} 个应用',
  todayUsageNone: '今天还没有记录',
  staleRelease: '你运行的是旧副本——比你已经构建出来的那份更旧（profile：{profile}）。',
  staleRunCommand: '运行这条命令，然后重启宿主：',
  startHere: '从这里开始',
  firstRunIntro: '现在还没有记录任何东西。电脑使用记录只记录你允许的应用，而且只记元数据——哪个应用、哪个文件、用了多久。',
  firstRunPrivacy: '它绝不记录屏幕内容、文档内容、选中文字或你输入的内容。密码管理器始终受保护。',
  startRecording: '开始记录',
  timeline: '时间线',
  timelineLoading: '正在加载时间线…',
  timelineEmpty: '最近七天还没有记录。',
  timelineUnavailable: '时间线暂时不可用。',
  timelineDayOne: '{day} · 1 个片段',
  timelineDayMany: '{day} · {count} 个片段',
  whyRecorded: '为什么会记录这一段？',
  resources: '资源：{resources}',
  noResourceApps: '没有可见资源。涉及应用：{apps}',
  summaries: '摘要',
  summaryRemote: '确定性摘要已开启。至少有一个范围使用远端模型，但只发送最小化的元数据；不会发送路径、URL 或文档名称。',
  summaryLocal: '摘要保留在本机。本地模型：{status}。',
  configured: '已配置',
  notConfigured: '未配置',
  summaryLoading: '正在加载摘要状态…',
  summaryUnavailable: '摘要状态暂时不可用。',
  summaryRemoteShort: '已开启远端摘要',
  summaryLocalShort: '本地摘要',
  previewPayload: '预览发送内容',
  turnOffPurge: '关闭并清除摘要',
  noModelScope: '当前没有范围使用模型。',
  resumeHit: '继续“{title}”——打开 {resource}（{citations} 条依据，置信度 {confidence}）。',
  resumeAmbiguous: '有多个候选：{reason}',
  resumeNone: '没有可继续的内容：{reason}',
  resume: '从这里继续',
  lastActivity: '上次活动',
  resumeAria: '描述要继续的工作',
  resumePlaceholder: '例如：继续计费那件事',
  resumeFind: '找到上次的位置',
  resumeRecentMeta: '{app} · {duration}',
  workThreads: '工作线索',
  workThreadsLoading: '正在加载工作线索…',
  workThreadsUnavailable: '工作线索暂时不可用。',
  workThreadsEmpty: '还没有成线索的工作：需要宿主能确认的工作区才会成线索。',
  workThreadMetaOne: ' · 1 个片段 · {citations} 条依据',
  workThreadMetaMany: ' · {episodes} 个片段 · {citations} 条依据',
  threadMeta: '{episodes} 个片段 · {duration}',
  statusLine: '采集：{capture} · 辅助功能：{accessibility} · 保留：{hours} 小时',
  stateUnavailable: '电脑使用记录状态暂不可用。',
  loadingHistory: '正在加载电脑使用记录…',
  statusDetail: '状态详情：{reason}',
  recordingTitle: '记录',
  pausedFeedback: '已暂停。',
  recordingFeedback: '已开始记录。',
  recordingOnDescription: '正在记录这台电脑的活动。只记你允许的，而且只记元数据。',
  recordingOffDescription: '当前没有在记录。新的内容不会被写入。',
  recordingOnDescriptionShort: '正在记录你允许的应用、网站和文件使用元数据。',
  recordingOffDescriptionShort: '当前不会写入新的电脑使用记录。',
  settingOn: '已开启',
  settingPaused: '已暂停',
  settingUnavailable: '不可用',
  pauseRecording: '暂停记录',
  recordingUnavailable: '记录暂不可用',
  whyReason: '原因：{reason}',
  appAllowedFeedback: '已允许该应用。',
  appForgottenFeedback: '已忘记该应用及其历史。',
  applicationsTitle: '参与的应用与网站',
  applicationsDescriptionShort: '选择哪些应用和网站可以出现在使用记录中。',
  applicationsValue: '{count} 个已允许',
  applicationsSummary: '已允许 {allowed} 项，已拒绝 {denied} 项。密码管理器无论这里怎么设置都受保护。',
  applicationsNone: '还没有允许任何应用，所以什么都不会被记录。',
  forget: '忘记',
  bundleIdAria: '应用 Bundle ID',
  bundleIdPlaceholder: '例如 com.apple.Safari',
  allowApp: '允许应用',
  retentionValidation: '请输入整数：原始记录 {observationMin}–{observationMax} 小时；片段 {episodeMin}–{episodeMax} 天。',
  saved: '已保存。',
  retentionTitle: '历史保留多久',
  retentionDescription: '原始观测，以及由它构建出的片段。修改只影响之后记录的内容，不会删除你已经有的历史。',
  retentionDescriptionShort: '设置电脑使用记录数据的保留时长。',
  retentionValue: '{days} 天',
  observationsHours: '原始记录（小时）',
  episodesDays: '片段（天）',
  save: '保存',
  historyDeleted: '历史已删除。',
  deleteTitle: '删除历史',
  deleteDescription: '删除会移除它覆盖范围内的观测与片段，且无法撤销。',
  deleteDescriptionShort: '清除电脑使用记录数据。',
  confirmDeleteAll: '确认：删除全部',
  cancel: '取消',
  deleteAll: '删除全部历史…',
  pairingCreated: '已生成新的配对令牌。',
  companionTitle: '浏览器伴侣',
  companionDescriptionShort: '连接浏览器扩展，记录网页活动元数据。',
  companionConnected: '已连接',
  companionWaiting: '等待配对',
  companionUnavailableShort: '不可用',
  companionListeningPaired: '正在监听 127.0.0.1:{port}，已配对。',
  companionListeningUnpaired: '正在监听 127.0.0.1:{port}，还没有配对。',
  companionUnavailable: '这台宿主上伴侣接收端不可用。',
  companionDescription: '页面只通过已配对的扩展记录：辅助功能分不清隐私窗口和普通窗口。',
  createPairingToken: '生成配对令牌',
  aboutTitle: '关于',
  aboutDescriptionShort: '版本、隐私与采集器状态。',
  aboutState: '采集：{capture} · 辅助功能：{accessibility} · 采集器 {collector}',
  stateUnavailableRow: '状态暂不可用。',
  privacyLocal: '它绝不记录屏幕内容、文档内容、选中文字或你输入的内容。一切都留在这台机器上。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'computer-history': HistoryLocaleKey
  }
}

export type HistoryTranslate = TranslateNS<typeof HISTORY_LOCALE_NS>

export function captureLabel(
  t: HistoryTranslate,
  capture: string,
): string {
  switch (capture) {
    case 'running': return t('captureRunning')
    case 'paused': return t('capturePaused')
    case 'stopped': return t('captureStopped')
    case 'degraded': return t('captureDegraded')
    case 'permission-required': return t('capturePermission')
    default: return capture
  }
}

/**
 * A browser or network failure is not UI copy. `fetch` rejects with `TypeError: Failed to fetch`, and the
 * first version of the two views printed that message straight into the panel. Known causes get a sentence
 * in the interface language; anything else keeps its own text, because an unknown failure stated truthfully
 * beats a friendly sentence that hides what happened.
 */
export function failureText(t: (key: HistoryLocaleKey, params?: Record<string, string | number>) => string, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) return t('loadFailed')
  return message
}

/**
 * Host reason codes are not UI copy.
 *
 * The Host states why capture is not running as a stable code (`capture-owned-by-another-host`) or, on some
 * paths, as a sentence meant for a log. Both used to reach the panel unchanged. Known codes get a sentence in
 * the interface language; anything unknown keeps its own text, because a reason we do not recognise is better
 * shown than hidden behind a friendly phrase.
 */
const REASON_KEYS: Record<string, HistoryLocaleKey> = {
  'capture-owned-by-another-host': 'reasonCaptureOwnedByAnotherHost',
  'computer history capture is owned by another DSH Host': 'reasonCaptureOwnedByAnotherHost',
  'capture policy is owned by another DSH Host': 'reasonPolicyOwnedByAnotherHost',
  'computer history capture is disabled': 'reasonCaptureDisabled',
  'computer history capture is unavailable on this DSH Host': 'reasonCaptureUnavailable',
}

export function reasonText(t: HistoryTranslate, reason: string): string {
  const key = REASON_KEYS[reason.trim()]
  return key ? t(key) : reason
}

function labels(resources: readonly { displayLabel?: string; canonicalUri: string }[], limit: number, t: HistoryTranslate): string {
  const shown = resources.slice(0, limit).map(resource => resource.displayLabel ?? resource.canonicalUri)
  const more = resources.length - shown.length
  return shown.join(', ') + (more > 0 ? t('andMore', { count: more }) : '')
}

/** One timeline row reads as the evidence behind it, in the interface language. */
export function episodeLineText(t: HistoryTranslate, episode: {
  readonly resources: readonly { displayLabel?: string; canonicalUri: string }[]
  readonly surfaces: readonly { bundleId: string }[]
}): string {
  const parts: string[] = []
  if (episode.resources.length > 0) parts.push(t('episodeResources', { resources: labels(episode.resources, 3, t) }))
  const apps = [...new Set(episode.surfaces.map(surface => surface.bundleId))].slice(0, 3)
  if (apps.length > 0) parts.push(t('episodeApps', { apps: apps.join(', ') }))
  return parts.length > 0 ? parts.join(' · ') : t('episodeNoEvidence')
}

/** The subject of a work thread: where it happened and what it touched. */
export function threadSubjectText(t: HistoryTranslate, thread: {
  readonly workspaceTitle?: string
  readonly resources: readonly { displayLabel?: string; canonicalUri: string }[]
}): string {
  const where = thread.workspaceTitle ?? t('unnamedWorkspace')
  return thread.resources.length > 0
    ? `${where} · ${labels(thread.resources, 3, t)}`
    : where
}
