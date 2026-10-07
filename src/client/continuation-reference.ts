import type { Context } from '@deepseek-ai/cordis'
import type { EpisodeSummary } from '../shared/index.js'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    'computer-history': unknown
  }
}
import type { IConversation, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  COMPUTER_HISTORY_REFERENCE_LABEL,
  computerHistoryReferenceUri,
  formatComputerHistoryMention,
} from '../shared/index.js'
import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

import { historyApi } from './api.js'

export const COMPUTER_HISTORY_REFERENCE_SOURCE = 'computer-history' as const

function sessions(ctx: Context): ISessions {
  const service = ctx.get('sessions') as ISessions | undefined
  if (service === undefined) throw new Error('DSH Session Controller is unavailable')
  return service
}

function workspaceController(ctx: Context): IWorkspaces {
  const service = ctx.get('workspaces') as IWorkspaces | undefined
  if (service === undefined) throw new Error('DSH Workspace Controller is unavailable')
  return service
}

function conversation(ctx: Context): IConversation {
  const service = ctx.get('conversation') as IConversation | undefined
  if (service === undefined) throw new Error('DSH Conversation service is unavailable')
  return service
}

function workspaceNavigation(ctx: Context): UiWorkspace {
  const service = ctx.get('uiWorkspace') as UiWorkspace | undefined
  if (service === undefined) throw new Error('DSH Workspace navigation is unavailable')
  return service
}

function inputTriggers(ctx: Context): InputTriggerServiceContract {
  const service = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (service === undefined) {
    throw new Error('Computer History reference support is unavailable in this DSH build')
  }
  return service
}

async function continuationWorkspaceId(
  ctx: Context,
  episode: EpisodeSummary,
): Promise<WorkspaceId> {
  const controller = workspaceController(ctx)
  const snapshot = controller.list.getSnapshot()

  const recordedId = episode.workspace?.id
  if (recordedId) {
    const byId = snapshot.items.find(
      item => String(item.workspaceId) === recordedId,
    )
    if (byId) return byId.workspaceId
  }

  const recordedRoot = episode.workspace?.root
  if (recordedRoot) {
    const byPath = snapshot.items.find(item => item.path === recordedRoot)
    if (byPath) return byPath.workspaceId

    try {
      // Continue is an explicit user action. Registering the exact recorded
      // local root makes the DSH hero actionable and is idempotent by Host
      // contract; never substitute an unrelated recent Workspace.
      return (await controller.create({ path: recordedRoot })).workspaceId
    } catch {
      // The historical root may have moved or disappeared. Fall through to
      // DSH's own general-purpose default Workspace rather than an inert
      // ungrouped Session.
    }
  }

  const fallback = await controller.initializeDefault()
  if (!fallback) {
    throw new Error('DSH could not prepare a workspace for this continuation')
  }
  return fallback.workspaceId
}

export function computerHistoryReference(
  episodeId: EpisodeSummary['id'],
): ReferenceInsert {
  const ref = computerHistoryReferenceUri(episodeId)
  return {
    source: COMPUTER_HISTORY_REFERENCE_SOURCE,
    ref,
    label: COMPUTER_HISTORY_REFERENCE_LABEL,
    clipboardText: formatComputerHistoryMention(ref),
  }
}

/**
 * Own the native DSH reference chip. The visible chip carries only an opaque
 * Episode reference; model context is resolved from the Session binding.
 */
export function registerComputerHistoryReferenceSource(ctx: Context): () => void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: COMPUTER_HISTORY_REFERENCE_SOURCE,
    order: 40,
    showGroupTitle: false,
    // Continue inserts this reference programmatically. Keeping discovery empty
    // avoids turning every @ keystroke into a Computer History network lookup.
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: {
      clipboardText: ref => formatComputerHistoryMention(ref),
      serialize: ref => Promise.resolve(formatComputerHistoryMention(ref)),
    },
  }
  return inputTriggers(ctx).registerSource(source)
}

/**
 * Start a DSH conversation for one recorded work Episode and seed its blank
 * composer with the native Computer History reference chip.
 */
export async function continueEpisodeInDsh(
  ctx: Context,
  episode: EpisodeSummary,
): Promise<void> {
  const sessionController = sessions(ctx)
  const navigation = workspaceNavigation(ctx)
  const workspaceId = await continuationWorkspaceId(ctx, episode)

  // Ask the Workspace owner for the exact blank Session it intends to open.
  // openWorkspace() will resolve the same id again and gives us a synchronous
  // beforeOpen seam after mainView retain but before navigation commits.
  const sessionId = await navigation.connectWorkspace(workspaceId)
  const preparation = sessionController.retain(sessionId, {
    source: COMPUTER_HISTORY_REFERENCE_SOURCE,
  })

  let bound = false
  let insertedInput: ReturnType<IConversation['input']['for']> | undefined
  try {
    await preparation.ready
    const preflightScope = sessionController.scope(sessionId)
    if (preflightScope === undefined) {
      throw new Error('DSH prepared the continuation session without a client scope')
    }
    const preflight = conversation(ctx).input.for(preflightScope).state.getSnapshot()
    if (
      preflight.draft !== ''
      || preflight.occurrences.length !== 0
      || preflight.attachmentIds.length !== 0
    ) {
      throw new Error('new continuation session unexpectedly contains a draft')
    }

    await historyApi.bindContinuationSession({
      sessionId: String(sessionId),
      episodeId: episode.id,
    })
    bound = true

    await navigation.openWorkspace(workspaceId, openedId => {
      if (String(openedId) !== String(sessionId)) {
        throw new Error('DSH selected a different blank session for continuation')
      }
      const scope = sessionController.scope(openedId)
      if (scope === undefined) {
        throw new Error('DSH opened the continuation session without a client scope')
      }
      const input = conversation(ctx).input.for(scope)
      const state = input.state.getSnapshot()
      if (
        state.draft !== ''
        || state.occurrences.length !== 0
        || state.attachmentIds.length !== 0
      ) {
        throw new Error('opened continuation session unexpectedly contains a draft')
      }

      const inserted = input.insertReference(
        computerHistoryReference(episode.id),
        { start: 0, end: 0, draftRev: state.draftRev },
      )
      if (!inserted) {
        throw new Error('DSH composer refused the Computer History reference')
      }
      insertedInput = input
    })

    queueMicrotask(() => { insertedInput?.focus() })
  } catch (error) {
    insertedInput?.setDraft('')
    if (bound) {
      await historyApi.unbindContinuationSession(String(sessionId))
        .catch(() => undefined)
    }
    throw error
  } finally {
    preparation.release()
  }
}
