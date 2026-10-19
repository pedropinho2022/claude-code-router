// Calendar windows shared by the local-estimate account meters and spend limits.

export function localEstimateWindowStart(window: string, now: Date): Date {
  const start = new Date(now);
  if (window === "5h") {
    start.setHours(start.getHours() - 5);
    return start;
  }
  if (window === "weekly") {
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (window === "monthly") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  start.setHours(0, 0, 0, 0);
  return start;
}

export function localEstimateResetAt(window: string, now: Date): Date {
  const resetAt = localEstimateWindowStart(window, now);
  if (window === "5h") {
    resetAt.setHours(resetAt.getHours() + 5);
    return resetAt;
  }
  if (window === "weekly") {
    resetAt.setDate(resetAt.getDate() + 7);
    return resetAt;
  }
  if (window === "monthly") {
    resetAt.setMonth(resetAt.getMonth() + 1);
    return resetAt;
  }
  resetAt.setDate(resetAt.getDate() + 1);
  return resetAt;
}
