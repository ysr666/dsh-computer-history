import Foundation

let livenessHeartbeatInterval: TimeInterval = 30

/// Changes emit immediately. Unchanged eligible state emits at most once per
/// liveness interval so Episode duration has evidence without one row per 5 s tick.
func shouldEmitObservation(
    fingerprintUnchanged: Bool,
    lastObservedAt: TimeInterval?,
    now: TimeInterval,
    livenessInterval: TimeInterval
) -> Bool {
    guard fingerprintUnchanged else { return true }
    guard let lastObservedAt else { return true }
    return now - lastObservedAt >= livenessInterval
}
