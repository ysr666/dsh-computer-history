import {
  COMPANION_BUNDLE_ID,
  type NativeObservation,
} from '../../shared/index.js'
import { phase1AdapterForBundle } from '../ingestion/normalize.js'
import type { CompanionPayload } from './intake.js'

/**
 * The companion's payload as an observation the existing ingestion path can
 * take unchanged (ADR 0007): the provider marks the provenance that unlocks URL
 * resources, and the synthetic bundle id is one no real application carries.
 *
 * The URL is composed from the validated origin and path only. The intake has
 * already refused anything with a query or a fragment, and `resourceOf` strips
 * them again host-side.
 */
export function companionObservation(
  payload: CompanionPayload,
): NativeObservation {
  if (payload.source === 'editor') {
    // The editor's document path becomes the resource, and the adapter is the
    // real editor adapter - the editor vouched for this, so the observation does
    // not have to be guessed from a window title.
    return {
      v: 1,
      type: 'observation',
      collectorSession: payload.editorSession,
      seq: payload.seq,
      observedAtMs: payload.observedAtMs,
      // The identity the extension declared (ADR 0011). It is recorded as a
      // claim - `source.provider` stays 'companion' - and the allow-list and the
      // protected set decide exactly as they do for any other observation.
      app: {
        pid: 0,
        bundleId: payload.app.bundleId,
        name: payload.app.name,
      },
      window: {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.filePath ? { document: payload.filePath } : {}),
      },
      privacy: { secure: false, protected: false },
      // The editor vouched for this root; ingestion records it as such rather
      // than letting the resolver infer one from the document path.
      workspace: {
        root: payload.workspaceRoot,
        title: payload.workspaceRoot.split('/').findLast(segment => segment !== '')
          ?? payload.workspaceRoot,
      },
      // Derived from the bundle the editor claimed, through the same table the collector path uses, so a row
      // from IntelliJ says `jetbrains` instead of `vscode`. `generic` is the type's own word for "an
      // adapter this build does not know" - and ingestion refuses such a bundle by name before storing it.
      source: {
        provider: 'companion',
        adapter: phase1AdapterForBundle(payload.app.bundleId) ?? 'generic',
      },
    }
  }

  return {
    v: 1,
    type: 'observation',
    collectorSession: payload.browserSession,
    seq: payload.seq,
    observedAtMs: payload.observedAtMs,
    app: {
      pid: 0,
      bundleId: COMPANION_BUNDLE_ID,
      name: 'Browser companion',
    },
    window: {
      ...(payload.title ? { title: payload.title } : {}),
      url: `${payload.origin}${payload.path}`,
    },
    privacy: { secure: false, protected: false },
    source: { provider: 'companion', adapter: 'browser' },
  }
}
