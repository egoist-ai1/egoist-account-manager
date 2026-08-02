import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import readline from "node:readline";
import { describe, expect, it } from "vitest";
import {
  WindowsDesktopLifecycleService,
  type WindowsDesktopLifecycleAdapter,
  type WindowsDesktopSnapshot,
  type WindowsProcessSnapshot
} from "../../src/main/services/windowsDesktopLifecycleService";

interface FixtureTree {
  root: ChildProcess;
  rootPid: number;
  childPid: number;
  createdAt: string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminate(pid: number): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(pid);
  } catch {
    // The fixture may have exited between the identity check and termination.
  }
}

async function spawnFixtureTree(): Promise<FixtureTree> {
  const idleScript = "setInterval(() => {}, 1000)";
  const rootScript = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(idleScript)}], { stdio: 'ignore', windowsHide: true });`,
    "process.stdout.write(String(child.pid) + '\\n');",
    "setInterval(() => {}, 1000);"
  ].join("\n");
  const root = spawn(process.execPath, ["-e", rootScript], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (!root.pid || !root.stdout) throw new Error("Failed to start the isolated desktop fixture");
  const lines = readline.createInterface({ input: root.stdout });
  const [line] = await Promise.race([
    once(lines, "line"),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Isolated desktop fixture did not report its child PID")), 5_000);
    })
  ]);
  lines.close();
  const childPid = Number(line);
  if (!Number.isInteger(childPid) || childPid <= 0) {
    terminate(root.pid);
    throw new Error("Isolated desktop fixture returned an invalid child PID");
  }
  return {
    root,
    rootPid: root.pid,
    childPid,
    createdAt: new Date().toISOString()
  };
}

class NativeFixtureAdapter implements WindowsDesktopLifecycleAdapter {
  readonly platform = "win32" as const;
  readonly installLocation = path.dirname(process.execPath);
  readonly packageFullName = "OpenAI.Codex_isolated_fixture";
  readonly trees: FixtureTree[] = [];
  launchCount = 0;

  constructor(initial: FixtureTree) {
    this.trees.push(initial);
  }

  async snapshot(): Promise<WindowsDesktopSnapshot> {
    const processes: WindowsProcessSnapshot[] = [];
    for (const [index, tree] of this.trees.entries()) {
      if (isAlive(tree.rootPid)) {
        processes.push({
          pid: tree.rootPid,
          parentPid: process.pid,
          creationDate: tree.createdAt,
          executablePath: process.execPath,
          processName: path.basename(process.execPath),
          commandLine: `"${process.execPath}" -e fixture-root`,
          mainWindowHandle: index === this.trees.length - 1 && this.launchCount > 0 ? 4242 : 0
        });
      }
      if (isAlive(tree.childPid)) {
        processes.push({
          pid: tree.childPid,
          parentPid: tree.rootPid,
          creationDate: `${tree.createdAt}:child`,
          executablePath: process.execPath,
          processName: path.basename(process.execPath),
          commandLine: `"${process.execPath}" --type=utility -e fixture-child`,
          mainWindowHandle: 0
        });
      }
    }
    return {
      packages: [{
        name: "OpenAI.Codex",
        packageFullName: this.packageFullName,
        packageFamilyName: "OpenAI.Codex_isolated",
        version: "0.0.0-test",
        installLocation: this.installLocation,
        executablePath: process.execPath
      }],
      startApps: [{
        name: "Codex isolated fixture",
        appId: "OpenAI.Codex_isolated!App"
      }],
      processes
    };
  }

  async requestGracefulClose(): Promise<"refused"> {
    return "refused";
  }

  async terminateExact(target: WindowsProcessSnapshot): Promise<"terminated" | "vanished"> {
    if (!isAlive(target.pid)) return "vanished";
    terminate(target.pid);
    return "terminated";
  }

  async launch(): Promise<void> {
    this.trees.push(await spawnFixtureTree());
    this.launchCount += 1;
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  cleanup(): void {
    for (const tree of this.trees) {
      terminate(tree.childPid);
      terminate(tree.rootPid);
    }
  }
}

describe("WindowsDesktopLifecycleService isolated native process E2E", () => {
  it.runIf(process.platform === "win32")(
    "terminates and relaunches only a synthetic desktop tree without touching Codex",
    async () => {
      const initial = await spawnFixtureTree();
      const adapter = new NativeFixtureAdapter(initial);
      const service = new WindowsDesktopLifecycleService(adapter, {
        controllerPid: process.pid,
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 3_000,
        pollIntervalMs: 25,
        launchReadinessTimeoutMs: 3_000,
        readinessStableSamples: 2
      });

      try {
        const quiesced = await service.quiesce("exact-tree-fallback");
        expect(quiesced).toMatchObject({
          status: "quiesced",
          capturedProcessCount: 2,
          remainingProcessCount: 0,
          usedExactTreeFallback: true
        });
        expect(isAlive(initial.rootPid)).toBe(false);
        expect(isAlive(initial.childPid)).toBe(false);

        const readiness = await service.launchAndWaitReady(quiesced.identity);
        const relaunched = adapter.trees.at(-1)!;
        expect(readiness).toMatchObject({
          rootPid: relaunched.rootPid,
          visibleWindowHandle: 4242,
          capturedProcessCount: 2
        });
        expect(adapter.launchCount).toBe(1);
        expect(relaunched.rootPid).not.toBe(initial.rootPid);
        expect(isAlive(relaunched.rootPid)).toBe(true);
        expect(isAlive(relaunched.childPid)).toBe(true);
      } finally {
        adapter.cleanup();
      }
    },
    15_000
  );
});
