import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { runWindowsSupervisor } from "../../scripts/dev.mjs";

const node = process.execPath;
const delayed = "setInterval(() => {}, 1000)";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function fakeProcess() {
  const eventTarget = new EventEmitter();
  eventTarget.exitCode = undefined;
  return eventTarget;
}

function childScript(code, delayMs = 10_000) {
  return { command: node, args: ["-e", `setTimeout(() => process.exit(${code}), ${delayMs});`] };
}

test("first failed child ends the runner and cleans up its sibling process", async () => {
  const killed = [];
  const supervisor = runWindowsSupervisor({
    processObject: fakeProcess(),
    childServices: [childScript(7, 100), { command: node, args: ["-e", delayed] }],
    killTree: async child => {
      killed.push(child.pid);
      child.kill("SIGTERM");
    },
  });

  assert.equal(await supervisor.done, 1);
  assert.equal(killed.length, 1);
  const states = await Promise.all(supervisor.children.map(child => child.closed));
  assert.equal(states.length, 2);
  assert.ok(supervisor.children.every(child => child.exitCode !== null || child.signalCode !== null));
});

test("Ctrl+C cleans up every owned child and resolves only after they exit", async () => {
  const processObject = fakeProcess();
  const killed = [];
  const supervisor = runWindowsSupervisor({
    processObject,
    childServices: [{ command: node, args: ["-e", delayed] }, { command: node, args: ["-e", delayed] }],
    killTree: async child => {
      killed.push(child.pid);
      child.kill("SIGTERM");
    },
  });

  await wait(150);
  processObject.emit("SIGINT");
  assert.equal(await supervisor.done, 130);
  assert.equal(killed.length, 2);
  assert.ok(supervisor.children.every(child => child.exitCode !== null || child.signalCode !== null));
  assert.equal(processObject.exitCode, 130);
});
