import {
  DETOUR_GRACE_MS,
  IDLE_BOUNDARY_MS,
  type ActivityObservation,
} from '../../shared/index.js'

export function hasStrongWorkspace(
  observation: ActivityObservation,
): boolean {
  if (
    observation.workspace.source !== 'dsh'
    && observation.workspace.source !== 'git'
    && observation.workspace.source !== 'companion'
  ) {
    return false
  }

  if (observation.workspace.confidence < 0.8) return false

  return observation.resource?.kind === 'file'
    || observation.resource?.kind === 'directory'
    || observation.resource?.kind === 'workspace'
}

export function sameWorkspace(
  left: ActivityObservation,
  right: ActivityObservation,
): boolean {
  if (left.workspace.id && right.workspace.id) {
    return left.workspace.id === right.workspace.id
  }

  if (left.workspace.root && right.workspace.root) {
    return left.workspace.root === right.workspace.root
  }

  return false
}

export function observationForcesIdleBoundary(
  observation: ActivityObservation,
): boolean {
  return (observation.activity.idleSeconds ?? 0) * 1000
    >= IDLE_BOUNDARY_MS
}

export function detourExpired(
  lastStrongAtMs: number,
  observedAtMs: number,
): boolean {
  return observedAtMs - lastStrongAtMs > DETOUR_GRACE_MS
}
