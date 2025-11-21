type ConsoleLevel = 'log' | 'info' | 'debug';

const DEFAULT_LEVELS: ConsoleLevel[] = ['log', 'info', 'debug'];
const noop = () => {};
const originalConsoleMap = new Map<ConsoleLevel, Console[ConsoleLevel]>();
let silenced = false;

const isProdEnvironment = (): boolean => {
  const hasImportMetaEnv = typeof import.meta !== 'undefined' && (import.meta as any)?.env;
  if (hasImportMetaEnv) {
    return Boolean((import.meta as any).env.PROD);
  }

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV === 'production';
  }

  return false;
};

const applySilence = (levels: ConsoleLevel[]) => {
  if (typeof console === 'undefined') {
    return;
  }

  levels.forEach((level) => {
    const method = console[level];
    if (typeof method === 'function' && !originalConsoleMap.has(level)) {
      originalConsoleMap.set(level, method.bind(console));
      console[level] = noop as Console[ConsoleLevel];
    } else {
      console[level] = noop as Console[ConsoleLevel];
    }
  });

  silenced = true;
};

const restoreConsole = () => {
  if (typeof console === 'undefined') {
    return;
  }

  originalConsoleMap.forEach((original, level) => {
    console[level] = original;
  });

  silenced = false;
};

export const initializeConsoleSilencer = (
  levels: ConsoleLevel[] = DEFAULT_LEVELS,
  force?: boolean
) => {
  // Temporary override (2025-11-19): keep debug logs visible in production so we can
  // capture GPU instancing telemetry. Remove this guard once the grid crash is resolved.
  const shouldSilence = false && (force ?? isProdEnvironment());
  if (shouldSilence && !silenced) {
    applySilence(levels);
  } else if (!shouldSilence && silenced) {
    restoreConsole();
  }

  (globalThis as Record<string, unknown>).__ENABLE_DEBUG_LOGS = () => {
    restoreConsole();
  };
  (globalThis as Record<string, unknown>).__DISABLE_DEBUG_LOGS = () => {
    applySilence(levels);
  };
};
