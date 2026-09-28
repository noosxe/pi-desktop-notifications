/**
 * Shared test support for the pi-desktop-notifications suite.
 * Not a test file — the node --test discovery pattern ignores it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** All PI_NOTIFY_* env vars read by the extension config. */
export const CONFIG_ENV_KEYS = [
  "PI_NOTIFY",
  "PI_NOTIFY_SOUND",
  "PI_NOTIFY_URGENCY",
  "PI_NOTIFY_PROMPT",
  "PI_NOTIFY_ABORT",
  "PI_NOTIFY_MIN_INTERVAL",
] as const;

export type ConfigEnvKey = (typeof CONFIG_ENV_KEYS)[number];

/** Run `fn` with a controlled set of PI_NOTIFY_* env vars, restoring afterwards. */
export function withEnv(
  vars: Partial<Record<ConfigEnvKey, string>>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const key of CONFIG_ENV_KEYS) saved.set(key, process.env[key]);
  for (const key of CONFIG_ENV_KEYS) {
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const key of CONFIG_ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
  } catch (err) {
    restore();
    throw err;
  }
}

export interface ExecCall {
  cmd: string;
  args: string[];
  opts: unknown;
}

/**
 * A minimal fake ExtensionAPI: `exec` always succeeds by default and every
 * call is recorded. `on`/`registerCommand` are enough for index.ts's factory.
 */
export function fakePi(
  result: { code: number; stdout: string } = { code: 0, stdout: "/usr/bin/fake" },
  options: { throwOnExec?: boolean } = {},
): { pi: ExtensionAPI; execLog: ExecCall[] } {
  const execLog: ExecCall[] = [];
  const fake = {
    exec: async (cmd: string, args: string[], opts?: unknown) => {
      execLog.push({ cmd, args, opts });
      if (options.throwOnExec) throw new Error("spawn failed");
      return result;
    },
  };
  return { pi: fake as unknown as ExtensionAPI, execLog };
}

/** Run `fn` with `process.platform` temporarily overridden. */
export function withPlatform(
  platform: NodeJS.Platform,
  fn: () => Promise<void> | void,
): Promise<void> | void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  const restore = () => {
    if (descriptor) Object.defineProperty(process, "platform", descriptor);
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
  } catch (err) {
    restore();
    throw err;
  }
}

/** Run `fn` with stdout write capture and a forced `isTTY` value. */
export function withCapturedStdout(isTTY: boolean, fn: () => void): string {
  let captured = "";
  const writeDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "write");
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  process.stdout.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  try {
    fn();
  } finally {
    if (writeDescriptor) Object.defineProperty(process.stdout, "write", writeDescriptor);
    else delete (process.stdout as { write?: unknown }).write;
    if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    else delete (process.stdout as { isTTY?: unknown }).isTTY;
  }
  return captured;
}
