// Episode quality metrics for a Computer History store.
//
//   node scripts/verify/episode-stats.mjs <history.sqlite> [--replay]
//
// Reports the two numbers Phase 2.0 tracks:
//   unanchored rate  — episodes without a workspace root (the panel calls them
//                      "Unanchored activity");
//   fragmentation    — episodes holding exactly one observation.
//
// `--replay` rebuilds episodes from the stored observations through the
// current builder (lib/ must be built) and reports the same numbers, which is
// how a builder change is checked against real data instead of a fixture.
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const target = process.argv[2]
if (!target || !existsSync(target)) {
  console.error(
    'usage: node scripts/verify/episode-stats.mjs <history.sqlite> [--replay]',
  )
  process.exit(2)
}
const replay = process.argv.includes('--replay')

function toObservation(row) {
  return {
    id: String(row.id),
    collectorSessionId: String(row.collector_session),
    seq: Number(row.collector_seq),
    observedAtMs: Number(row.observed_at_ms),
    app: {
      pid: Number(row.pid),
      bundleId: String(row.bundle_id),
      ...(row.app_name ? { displayName: String(row.app_name) } : {}),
    },
    surface: {
      kind: String(row.surface_kind),
      ...(row.window_title ? { title: String(row.window_title) } : {}),
    },
    ...(row.resource_id
      ? {
          resource: {
            kind: String(row.resource_kind),
            canonicalUri: String(row.resource_uri),
            ...(row.resource_label
              ? { displayLabel: String(row.resource_label) }
              : {}),
          },
        }
      : {}),
    workspace: row.workspace_root
      ? {
          ...(row.workspace_id ? { id: String(row.workspace_id) } : {}),
          root: String(row.workspace_root),
          ...(row.workspace_title
            ? { title: String(row.workspace_title) }
            : {}),
          source: String(row.workspace_source),
          confidence: Number(row.workspace_confidence),
        }
      : {
          source: 'none',
          confidence: 0,
        },
    activity:
      row.idle_seconds === null || row.idle_seconds === undefined
        ? {}
        : { idleSeconds: Number(row.idle_seconds) },
    privacy: {
      secure: Boolean(row.privacy_secure),
      protected: Boolean(row.privacy_protected),
    },
    source: {
      provider: String(row.source_provider),
      adapter: row.source_adapter ? String(row.source_adapter) : undefined,
    },
  }
}

function observationQuery(db) {
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(observations)')
      .all()
      .map(column => String(column.name)),
  )
  const has = name => columns.has(name)
  // Column names follow the store schema: collector_session, pid, and the
  // workspace_* set. `has` keeps the script usable if a column disappears.
  return `
    SELECT o.id, o.collector_session, o.collector_seq, o.observed_at_ms,
           o.pid, o.bundle_id,
           ${has('app_name') ? 'o.app_name' : 'NULL AS app_name'},
           o.surface_kind,
           ${has('window_title') ? 'o.window_title' : 'NULL AS window_title'},
           o.resource_id, r.kind AS resource_kind,
           r.canonical_uri AS resource_uri, r.display_label AS resource_label,
           ${has('workspace_id') ? 'o.workspace_id' : 'NULL AS workspace_id'},
           ${has('workspace_root') ? 'o.workspace_root' : 'NULL AS workspace_root'},
           ${has('workspace_title') ? 'o.workspace_title' : 'NULL AS workspace_title'},
           o.workspace_source, o.workspace_confidence,
           ${has('idle_seconds') ? 'o.idle_seconds' : 'NULL AS idle_seconds'},
           o.privacy_secure, o.privacy_protected, o.source_provider, o.source_adapter
    FROM observations o
    LEFT JOIN resources r ON r.id = o.resource_id
    WHERE o.privacy_secure = 0 AND o.privacy_protected = 0
    ORDER BY o.observed_at_ms
  `
}

function summarize(label, episodes, observations) {
  const withoutWorkspace = episodes.filter(
    episode => !episode.workspace,
  ).length

  const counts = episodes.map(episode => episode.observationIds.length)
  const single = counts.filter(count => count === 1).length

  const anchored = observations.filter(observation =>
    episodes.some(episode =>
      episode.observationIds.includes(observation.id),
    ),
  ).length

  console.log(`${label}:`)
  console.log(`  observations        ${observations.length}`)
  console.log(`  episodes            ${episodes.length}`)
  console.log(
    `  unanchored rate     ${episodes.length === 0 ? 'n/a' : (withoutWorkspace / episodes.length * 100).toFixed(0)}% (${withoutWorkspace}/${episodes.length} episodes without a workspace)`,
  )
  console.log(
    `  fragmentation       ${episodes.length === 0 ? 'n/a' : (single / episodes.length * 100).toFixed(0)}% (${single}/${episodes.length} episodes with one observation)`,
  )
  console.log(
    `  observations in episodes ${anchored}/${observations.length}`,
  )
}

const db = new DatabaseSync(target, { readOnly: true })
const observations = db
  .prepare(observationQuery(db))
  .all()
  .map(toObservation)
db.close()

console.log(`store: ${path.basename(target)}`)

const stored = new DatabaseSync(target, { readOnly: true })
const storedEpisodes = stored
  .prepare('SELECT id, primary_workspace_root FROM episodes')
  .all()
const links = stored
  .prepare('SELECT episode_id, observation_id FROM episode_observations')
  .all()
stored.close()

if (!replay) {
  const episodes = storedEpisodes.map(row => ({
    id: String(row.id),
    workspace: row.primary_workspace_root
      ? { root: String(row.primary_workspace_root) }
      : undefined,
    observationIds: links
      .filter(link => String(link.episode_id) === String(row.id))
      .map(link => String(link.observation_id)),
  }))
  summarize('stored', episodes, observations)
} else {
  // The package bundle exports the plugin entry, not the host internals, so
  // the replay compiles the episode module with the repository toolchain into
  // a temporary directory and imports that. It keeps the script reproducible
  // without adding a build step to the normal path.
  let buildEpisodes
  try {
    const temp = mkdtempSync(path.join(tmpdir(), 'dsh-episode-replay-'))
    const compiled = spawnSync(
      path.resolve('node_modules/.bin/tsc'),
      [
        'src/host/episodes/index.ts',
        '--outDir', temp,
        '--module', 'nodenext',
        '--target', 'es2022',
        '--moduleResolution', 'nodenext',
        // --ignoreConfig drops the repository tsconfig, so the library and
        // type roots the sources rely on have to be stated here.
        '--lib', 'es2023',
        '--types', 'node',
        '--skipLibCheck',
        '--ignoreConfig',
      ],
      { encoding: 'utf8' },
    )
    if (compiled.status !== 0) {
      throw new Error(compiled.stdout + compiled.stderr)
    }
    symlinkSync(path.resolve('node_modules'), path.join(temp, 'node_modules'))
    ;({ buildEpisodes } = await import(
      path.join(temp, 'host/episodes/index.js')
    ))
  } catch (error) {
    console.error(
      `--replay could not compile the episode module: ${error instanceof Error ? error.message : error}`,
    )
    process.exit(1)
  }
  summarize('replayed through the current builder', buildEpisodes(observations), observations)
}
