// Lightweight debug logging bus with in-memory ring buffer.
// Usage:
//   pushDebug({ area: 'SCORING', msg: 'Perfect!', data: { combo } });
//   subscribeDebug(listener) => unsubscribe
// Designed to be deterministic-friendly: logs are side-channel only.

export type DebugLogEntry = {
  ts: number; // simulation tick or Date.now fallback
  area: string; // e.g. SCORING, SPEED, DROP
  msg: string;
  data?: Record<string, any> | undefined;
};

const MAX_LOGS = 500;
let buffer: DebugLogEntry[] = [];
let listeners: Set<(e: DebugLogEntry) => void> = new Set();

export function pushDebug(entry: Omit<DebugLogEntry, 'ts'> & { ts?: number }) {
  const full: DebugLogEntry = {
    ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
    area: entry.area,
    msg: entry.msg,
    data: entry.data,
  };
  buffer.push(full);
  if (buffer.length > MAX_LOGS) buffer.splice(0, buffer.length - MAX_LOGS);
  listeners.forEach((l) => {
    try {
      l(full);
    } catch (_) {}
  });
}

// Unified emitter: logs to panel always; to console unless suppressed.
export function emitDebug(area: string, msg: string, data?: Record<string, any>) {
  pushDebug({ area, msg, data });
  const panelOnly = (globalThis as any).__DEBUG_PANEL_ONLY;
  if (!panelOnly) {
    // Pretty console formatting
    if (data) {
      // eslint-disable-next-line no-console
      // console.log(`[${area}] ${msg}`, data);
    } else {
      // eslint-disable-next-line no-console
      // console.log(`[${area}] ${msg}`);
    }
  }
}

export function getDebugLogs(): DebugLogEntry[] {
  return buffer.slice();
}

export function clearDebugLogs() {
  buffer = [];
}

export function subscribeDebug(fn: (e: DebugLogEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
