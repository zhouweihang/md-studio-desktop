import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogLevel } from '../shared/channels';

let logDirectory: string | null = null;

export function initLogger(userDataDir: string): void {
  logDirectory = join(userDataDir, 'logs');
  void mkdir(logDirectory, { recursive: true }).catch(() => undefined);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 统一日志出口：控制台 + 按天文件（RFC §5）。 */
export function logMain(level: LogLevel, message: string): void {
  const prefix = '[md-studio]';
  if (level === 'error') console.error(`${prefix} ${message}`);
  else if (level === 'warn') console.warn(`${prefix} ${message}`);
  else console.log(`${prefix} ${message}`);

  if (!logDirectory) return;
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const file = join(logDirectory, `main-${dateStamp()}.log`);
  void appendFile(file, `${line}\n`, 'utf8').catch(() => undefined);
}

export function installErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    logMain('error', `未捕获异常：${error.stack ?? error.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    logMain('error', `未处理的 Promise 拒绝：${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
}
