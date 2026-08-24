/**
 * Pure helpers for SessionEnd / shared-broker teardown decisions.
 * Foreign-session active jobs must keep the shared broker alive (#671 class).
 */

export function isActiveJob(job) {
  return job?.status === "queued" || job?.status === "running";
}

export function hasForeignActiveJobs(jobs, endingSessionId) {
  const active = (jobs ?? []).filter(isActiveJob);
  if (active.length === 0) {
    return false;
  }
  // Missing ending session id: any active job might belong to someone else.
  if (!endingSessionId) {
    return true;
  }
  // Active jobs with no sessionId, or a different sessionId, are foreign/unknown.
  return active.some((job) => !job.sessionId || job.sessionId !== endingSessionId);
}

/**
 * @param {{ jobs?: object[], endingSessionId?: string|null, brokerBusy?: boolean }} options
 * @returns {{ teardown: boolean, reason: string }}
 */
export function shouldTeardownSharedBroker(options = {}) {
  if (options.brokerBusy) {
    return { teardown: false, reason: "broker-busy" };
  }
  if (hasForeignActiveJobs(options.jobs, options.endingSessionId)) {
    return { teardown: false, reason: "foreign-active-jobs" };
  }
  return { teardown: true, reason: "safe" };
}
