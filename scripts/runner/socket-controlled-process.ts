import {
  createRunnerControlHost,
  type RunnerControlHost,
} from "../../src/services/runner-control-transport.js";

export interface SocketControlledProcess {
  proc: ReturnType<typeof Bun.spawn>;
  control: RunnerControlHost;
}

/**
 * Launch a backend without asking Bun to manage child IPC or output pipes.
 *
 * The tray runner reserves stdout for its native framing protocol, so the
 * backend inherits the runner's stderr for both output streams. The native
 * host already captures that stream for the launcher log.
 */
export function spawnSocketControlledProcess(options: {
  cmd: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  onMessage(message: unknown): void;
  onError(message: string): void;
  onDisconnect(): void;
}): SocketControlledProcess {
  const control = createRunnerControlHost({
    onMessage: options.onMessage,
    onError: options.onError,
    onDisconnect: options.onDisconnect,
  });

  try {
    const proc = Bun.spawn({
      cmd: options.cmd,
      cwd: options.cwd,
      env: { ...options.env, ...control.bootstrapEnv },
      stdin: "ignore",
      stdout: 2,
      stderr: 2,
      windowsHide: true,
    });
    return { proc, control };
  } catch (error) {
    control.close();
    throw error;
  }
}
