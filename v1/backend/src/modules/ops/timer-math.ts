export type OpenTimer = {
  startedAt: Date;
  closedAt: Date | null;
  pausedAt: Date | null;
  pauseAccumMinutes: number;
};

export function applyPauseAccum(
  session: OpenTimer,
  now: Date,
): { pauseAccumMinutes: number; pausedAt: null } {
  let pauseAccumMinutes = session.pauseAccumMinutes;
  if (session.pausedAt) {
    pauseAccumMinutes += Math.floor(
      (now.getTime() - session.pausedAt.getTime()) / 60_000,
    );
  }
  return { pauseAccumMinutes, pausedAt: null };
}

export function computeDurationMinutes(
  startedAt: Date,
  closedAt: Date,
  pauseAccumMinutes: number,
): number {
  return Math.max(
    0,
    Math.floor((closedAt.getTime() - startedAt.getTime()) / 60_000) -
      pauseAccumMinutes,
  );
}

export function computeElapsedMinutes(session: OpenTimer, now: Date): number {
  const end = session.closedAt ?? session.pausedAt ?? now;
  return Math.max(
    0,
    Math.floor((end.getTime() - session.startedAt.getTime()) / 60_000) -
      session.pauseAccumMinutes,
  );
}
