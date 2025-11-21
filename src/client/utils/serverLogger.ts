/**
 * Client-side logger that forwards logs to server
 * This allows viewing console.log() output via `devvit logs <subreddit>`
 */

interface LogMessage {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
  sessionId?: number;
  data?: any;
}

class ServerLogger {
  private queue: LogMessage[] = [];
  private flushInterval: number = 2000; // Send logs every 2 seconds
  private maxQueueSize: number = 50;
  private flushTimer: any = null;
  private sessionId: number = Math.floor(Math.random() * 100000);

  constructor() {
    this.startFlushTimer();
  }

  private startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  private async flush() {
    if (this.queue.length === 0) return;

    const logsToSend = [...this.queue];
    this.queue = [];

    try {
      // Send to server endpoint
      await fetch('/api/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          logs: logsToSend,
          userAgent: navigator.userAgent,
        }),
      });
    } catch (error) {
      // If sending fails, add back to queue (but don't create infinite loop)
      if (this.queue.length < this.maxQueueSize) {
        console.warn('Failed to send logs to server:', error);
      }
    }
  }

  log(level: LogMessage['level'], message: string, data?: any) {
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      data,
    };

    this.queue.push(logMessage);

    // If queue is full, flush immediately
    if (this.queue.length >= this.maxQueueSize) {
      this.flush();
    }
  }

  // Public methods matching console API
  public info(message: string, ...args: any[]) {
    this.log('info', message, args);
  }

  public warn(message: string, ...args: any[]) {
    this.log('warn', message, args);
  }

  public error(message: string, ...args: any[]) {
    this.log('error', message, args);
  }

  public debug(message: string, ...args: any[]) {
    this.log('log', message, args);
  }
}

// Create singleton instance
export const serverLogger = new ServerLogger();

/**
 * Intercepts console methods to send to server
 * Call this once in your app initialization
 */
export function enableServerLogging() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;

  console.log = function (...args: any[]) {
    originalLog.apply(console, args);
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    serverLogger.debug(message);
  };

  console.warn = function (...args: any[]) {
    originalWarn.apply(console, args);
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    serverLogger.warn(message);
  };

  console.error = function (...args: any[]) {
    originalError.apply(console, args);
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    serverLogger.error(message);
  };

  console.info = function (...args: any[]) {
    originalInfo.apply(console, args);
    const message = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');
    serverLogger.info(message);
  };

  console.log('📡 Server logging enabled - logs will appear in `devvit logs`');
}
