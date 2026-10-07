import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const services = [
  {
    name: "api",
    command: node,
    args: ["--env-file-if-exists=backend/.env.local", "--import", "tsx", "backend/src/server.ts"],
  },
  {
    name: "web",
    command: node,
    args: ["node_modules/next/dist/bin/next", "dev", "frontend"],
  },
];

function startUnixRunner() {
  const concurrentlyCli = path.join(root, "node_modules", "concurrently", "dist", "bin", "index.js");
  const commands = services.map(service => `${service.command} ${service.args.join(" ")}`);
  const runner = spawn(node, [concurrentlyCli, "--kill-others", "--success", "first", "--names", "api,web", ...commands], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  runner.on("error", error => {
    console.error(`Could not start concurrently: ${error.message}`);
    process.exitCode = 1;
  });
  runner.on("close", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

export function runWindowsSupervisor({
  spawnProcess = spawn,
  spawnTreeKiller = spawn,
  killTree: injectedKillTree,
  processObject = process,
  cwd = root,
  env = process.env,
  childServices = services,
} = {}) {
  const children = [];
  let stopping = false;
  let finalized = false;
  let exitCode = 0;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });

  const killTree = injectedKillTree ?? (child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
      resolve();
      return;
    }
    const killer = spawnTreeKiller("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      cwd,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => {
      child.kill("SIGTERM");
      resolve();
    });
    killer.once("close", code => {
      if (code !== 0) child.kill("SIGTERM");
      resolve();
    });
  }));

  const finish = code => {
    if (finalized) return;
    finalized = true;
    processObject.exitCode = code;
    processObject.removeListener("SIGINT", handleInterrupt);
    processObject.removeListener("SIGTERM", handleTerminate);
    resolveDone(code);
  };

  const shutdown = async code => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    const liveChildren = children.filter(child => child.exitCode === null && child.signalCode === null);
    await Promise.all(liveChildren.map(killTree));
    await Promise.all(liveChildren.map(child => child.closed));
    finish(exitCode);
  };

  const onChildClose = (child, code, signal) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.resolveClosed();
    if (!stopping) void shutdown(code === 0 ? 0 : 1);
  };

  const handleInterrupt = () => { void shutdown(130); };
  const handleTerminate = () => { void shutdown(143); };
  processObject.on("SIGINT", handleInterrupt);
  processObject.on("SIGTERM", handleTerminate);

  for (const service of childServices) {
    if (stopping) break;
    const child = spawnProcess(service.command, service.args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.name = service.name;
    child.closed = new Promise(resolve => { child.resolveClosed = resolve; });
    children.push(child);
    child.once("error", error => {
      console.error(`Could not start ${service.name}: ${error.message}`);
      child.exitCode = 1;
      child.resolveClosed();
      if (!stopping) void shutdown(1);
    });
    child.once("close", (code, signal) => onChildClose(child, code, signal));
  }

  if (children.length === 0) finish(1);
  return { done, children, shutdown };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform === "win32") {
    const run = runWindowsSupervisor();
    await run.done;
  } else {
    startUnixRunner();
  }
}
