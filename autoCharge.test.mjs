import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

const buttonsJs = compile("../src/lib/buttons.ts");
const patchesJs = compile("../src/lib/patches.ts");
const chargeJs = compile("../src/lib/autoCharge.ts");

const CROSS = 0;
const SQUARE = 1;
const CIRCLE = 8;
const TRIANGLE = 9;
const KEY_ON = "ps1web.autoCharge.on";
const KEY_BUTTONS = "ps1web.autoCharge.buttons";
const KEY_LEGACY = "ps1web.autoCharge.button";
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A fresh copy of the module, a fake clock, and a fake EmulatorJS core. */
function boot(seed = {}, { storageBlocked = false, withCore = true } = {}) {
  const storage = new Map(Object.entries(seed));
  let clock = 10_000;
  let nextId = 1;
  const timers = new Map();
  const handlers = { window: {}, document: {} };

  const window = {
    addEventListener: (type, fn) => (handlers.window[type] = fn),
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const document = { hidden: false, addEventListener: (type, fn) => (handlers.document[type] = fn) };
  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error("Storage blocked");
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error("Storage blocked");
      storage.set(key, value);
    },
  };

  const context = { exports: {}, window, document, localStorage, Date: { now: () => clock } };
  context.require = (name) => {
    if (name === "./buttons") {
      const exports = {};
      runInContext(`(function (exports) {${buttonsJs}\n})`, context)(exports);
      return exports;
    }
    if (name === "./patches") {
      const exports = {};
      runInContext(`(function (exports) {${patchesJs}\n})`, context)(exports);
      return exports;
    }
    assert.fail(`Unknown require: ${name}`);
  };
  createContext(context);
  runInContext(chargeJs, context);
  const api = context.exports;

  function attachCore() {
    const log = [];
    const gameManager = { simulateInput: (player, index, value) => log.push([index, value]) };
    window.EJS_emulator = { gameManager };
    return {
      log,
      gameManager,
      take() {
        return log.splice(0);
      },
    };
  }

  function advance(ms) {
    const target = clock + ms;
    for (;;) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { id, timer };
      }
      if (!next) break;
      timers.delete(next.id);
      clock = Math.max(clock, next.timer.at);
      next.timer.fn();
    }
    clock = target;
  }

  const core = withCore ? attachCore() : null;
  const charge = api.autoCharge;
  return {
    api,
    charge,
    core,
    storage,
    handlers,
    attachCore,
    advance,
    now: () => clock,
    state: () => plain(charge.getSnapshot()),
    key: (index, down) => window.EJS_emulator.gameManager.simulateInput(0, index, down ? 1 : 0),
    pad: (index, down) => api.padInput(index, down ? 1 : 0),
  };
}

const sorted = (list) => [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test("off by default: nothing is held and everything passes through", () => {
  const rig = boot();
  assert.deepEqual(rig.state(), { enabled: false, buttons: [SQUARE], charging: [], pending: [] });
  assert.equal(rig.api.ensureInstalled(), true);
  assert.deepEqual(rig.core.take(), []);
  rig.key(SQUARE, true);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1], [SQUARE, 0]]);
});

test("single mode holds □ exactly as before", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]]);
  assert.deepEqual(rig.state().charging, [SQUARE]);
});

test("雙開 adds △ without disturbing the held □", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  rig.charge.toggleDual();
  assert.deepEqual(rig.core.take(), [[TRIANGLE, 1]], "only the new button is written");
  assert.deepEqual(rig.state().buttons, [TRIANGLE, SQUARE], "kept in controller order");
  assert.deepEqual(rig.state().charging, [TRIANGLE, SQUARE]);
});

test("雙開 toggles back to □ alone and releases △", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();
  rig.charge.toggleDual();
  assert.deepEqual(rig.core.take(), [[TRIANGLE, 0]]);
  assert.deepEqual(rig.state().buttons, [SQUARE]);
  rig.charge.setButtons([TRIANGLE]);
  rig.charge.toggleDual();
  assert.deepEqual(rig.state().buttons, [TRIANGLE, SQUARE], "from a single △ it opens the pair");
});

test("pressing one button fires only that one; the other keeps charging", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();

  rig.key(SQUARE, true);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]]);
  assert.deepEqual(rig.state().charging, [TRIANGLE], "△ never let go");

  rig.advance(300);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]], "□ resumes the moment it is released");
  assert.deepEqual(rig.state().charging, [TRIANGLE, SQUARE]);
});

test("both buttons pressed together fire together and recover independently", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();

  rig.key(TRIANGLE, true);
  rig.key(SQUARE, true);
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 0], [TRIANGLE, 0]]);
  assert.deepEqual(rig.state().charging, []);

  rig.advance(20);
  rig.key(TRIANGLE, false);
  rig.advance(30);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [], "both taps are still inside their release window");

  rig.advance(100);
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
  assert.deepEqual(rig.state().charging, [TRIANGLE, SQUARE]);
});

test("a quick tap keeps the shot button released for at least 100 ms", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  const pressedAt = rig.now();
  rig.key(SQUARE, true);
  rig.advance(20);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]]);
  rig.advance(70);
  assert.deepEqual(rig.core.take(), [], "still released at 90 ms");
  rig.advance(25);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]]);
  assert.ok(rig.now() - pressedAt >= 100, "never before the 100 ms mark");
});

test("a quick tap on one button does not delay the other button's recovery", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();
  rig.key(TRIANGLE, true);
  rig.advance(10);
  rig.key(SQUARE, true);
  rig.advance(10);
  rig.key(TRIANGLE, false);
  rig.advance(10);
  rig.key(SQUARE, false);
  rig.core.take();
  rig.advance(80);
  assert.deepEqual(rig.core.take(), [[TRIANGLE, 1]], "△ was pressed first, so it recovers first");
  rig.advance(20);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]]);
});

test("pressing again inside the release window restarts the window", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  rig.key(SQUARE, true);
  rig.advance(20);
  rig.key(SQUARE, false);
  rig.advance(20);
  rig.key(SQUARE, true);
  rig.advance(20);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]], "released once, never written twice");
  rig.advance(70);
  assert.deepEqual(rig.core.take(), [], "100 ms from the second press has not passed");
  rig.advance(40);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]]);
});

test("a held key counts even when another source released the same button", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  rig.key(SQUARE, true);
  rig.pad(SQUARE, true);
  rig.advance(300);
  rig.pad(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]], "the keyboard still holds it");
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1]]);
});

test("repeated events do not duplicate writes or republish an unchanged state", () => {
  const rig = boot();
  let updates = 0;
  rig.charge.subscribe(() => updates++);
  rig.charge.setEnabled(true);
  const first = rig.charge.getSnapshot();
  const before = updates;
  rig.key(CIRCLE, true);
  rig.key(CIRCLE, false);
  assert.equal(rig.charge.getSnapshot(), first, "unmanaged buttons never touch the state");
  assert.equal(updates, before);
  rig.core.take();
  rig.key(SQUARE, true);
  rig.key(SQUARE, true);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]], "one write for two identical events");
  rig.charge.setEnabled(true);
  rig.charge.setButtons([SQUARE]);
  rig.charge.toggleButton(99);
  assert.equal(rig.charge.getSnapshot().buttons.length, 1);
});

test("other buttons pass straight through while charging", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  rig.key(CIRCLE, true);
  rig.key(CIRCLE, false);
  rig.key(TRIANGLE, true);
  rig.key(TRIANGLE, false);
  assert.deepEqual(rig.core.take(), [[CIRCLE, 1], [CIRCLE, 0], [TRIANGLE, 1], [TRIANGLE, 0]]);
  rig.pad(CROSS, true);
  rig.pad(CROSS, false);
  assert.deepEqual(rig.core.take(), [[CROSS, 1], [CROSS, 0]]);
});

test("switching auto-charge off hands every button back exactly as it is held", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.key(SQUARE, true);
  rig.core.take();
  rig.charge.setEnabled(false);
  assert.deepEqual(
    sorted(rig.core.take()),
    [[SQUARE, 1], [TRIANGLE, 0]],
    "□ is still down because the player holds it; △ is released",
  );
  assert.deepEqual(rig.state().charging, []);
  rig.key(SQUARE, false);
  assert.deepEqual(rig.core.take(), [[SQUARE, 0]], "back to plain pass-through");
});

test("removing a button releases it; the last one cannot be removed", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();
  rig.charge.toggleButton(TRIANGLE);
  assert.deepEqual(rig.core.take(), [[TRIANGLE, 0]]);
  assert.deepEqual(rig.state().buttons, [SQUARE]);
  rig.charge.toggleButton(SQUARE);
  assert.deepEqual(rig.core.take(), []);
  assert.deepEqual(rig.state().buttons, [SQUARE]);
  rig.charge.toggleButton(CIRCLE);
  assert.deepEqual(rig.state().buttons, [SQUARE, CIRCLE], "any face button can be added");
});

test("the last remaining button is kept even when it is not the default one", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.setButtons([TRIANGLE]);
  rig.core.take();
  rig.charge.toggleButton(TRIANGLE);
  assert.deepEqual(rig.state().buttons, [TRIANGLE], "not silently replaced by the default □");
  assert.deepEqual(rig.state().charging, [TRIANGLE]);
  assert.deepEqual(rig.core.take(), [], "and nothing is released or pressed");
});

test("moving the selection to a different button swaps which one is held", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.core.take();
  rig.charge.setButtons([TRIANGLE]);
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 0], [TRIANGLE, 1]]);
});

test("invalid selections fall back safely and keep controller order", () => {
  const rig = boot();
  rig.charge.setButtons([]);
  assert.deepEqual(rig.state().buttons, [SQUARE]);
  rig.charge.setButtons([99, "x", SQUARE, SQUARE, TRIANGLE]);
  assert.deepEqual(rig.state().buttons, [TRIANGLE, SQUARE]);
  rig.charge.setButtons([42]);
  assert.deepEqual(rig.state().buttons, [SQUARE]);
  rig.charge.setButtons([CIRCLE, CROSS, TRIANGLE, SQUARE]);
  assert.deepEqual(rig.state().buttons, [TRIANGLE, SQUARE, CROSS, CIRCLE]);
});

test("the choice is saved and restored", () => {
  const first = boot();
  first.charge.setEnabled(true);
  first.charge.toggleDual();
  assert.equal(first.storage.get(KEY_BUTTONS), JSON.stringify([TRIANGLE, SQUARE]));
  assert.equal(first.storage.get(KEY_ON), "1");

  const next = boot(Object.fromEntries(first.storage));
  assert.deepEqual(next.state(), { enabled: true, buttons: [TRIANGLE, SQUARE], charging: [], pending: [] });
  next.api.ensureInstalled();
  assert.deepEqual(sorted(next.core.take()), [[SQUARE, 1], [TRIANGLE, 1]], "both held from the first frame");
});

test("an old single-button choice is migrated, bad data is ignored", () => {
  assert.deepEqual(boot({ [KEY_LEGACY]: String(TRIANGLE) }).state().buttons, [TRIANGLE]);
  assert.deepEqual(boot({ [KEY_LEGACY]: "99" }).state().buttons, [SQUARE]);
  assert.deepEqual(boot({ [KEY_BUTTONS]: "not json", [KEY_LEGACY]: String(CIRCLE) }).state().buttons, [CIRCLE]);
  assert.deepEqual(boot({ [KEY_BUTTONS]: "[]" }).state().buttons, [SQUARE]);
  assert.deepEqual(boot({ [KEY_BUTTONS]: '{"a":1}' }).state().buttons, [SQUARE]);
  assert.deepEqual(boot({ [KEY_BUTTONS]: '[99,"x"]' }).state().buttons, [SQUARE]);
  assert.deepEqual(boot({ [KEY_BUTTONS]: "[1,9]", [KEY_LEGACY]: "8" }).state().buttons, [TRIANGLE, SQUARE], "new format wins");
});

test("everything works when localStorage is unavailable", () => {
  const rig = boot({}, { storageBlocked: true });
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
});

test("a cheat sequence suspends both buttons and charging resumes afterwards", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.core.take();

  rig.api.setMacroSuspended(true);
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 0], [TRIANGLE, 0]]);
  assert.deepEqual(rig.state().charging, []);
  rig.api.coreInput(SQUARE, 1);
  rig.api.coreInput(SQUARE, 0);
  assert.deepEqual(rig.core.take(), [[SQUARE, 1], [SQUARE, 0]], "the sequence reaches the game untouched");

  rig.api.setMacroSuspended(false);
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
});

test("losing window focus clears keys that never reported being released", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  rig.key(TRIANGLE, true);
  rig.key(SQUARE, true);
  rig.advance(400);
  rig.core.take();
  rig.handlers.window.blur();
  assert.deepEqual(sorted(rig.core.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
  assert.deepEqual(rig.state().charging, [TRIANGLE, SQUARE]);
});

test("a new game is hooked and charged from scratch", () => {
  const rig = boot();
  rig.charge.setEnabled(true);
  rig.charge.toggleDual();
  const next = rig.attachCore();
  assert.equal(rig.api.ensureInstalled(), true);
  assert.deepEqual(sorted(next.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
});

test("turning it on before the emulator exists charges as soon as it does", () => {
  const rig = boot({}, { withCore: false });
  rig.charge.toggleDual();
  rig.charge.setEnabled(true);
  assert.deepEqual(rig.state(), { enabled: true, buttons: [TRIANGLE, SQUARE], charging: [], pending: [] });
  rig.pad(CIRCLE, true);
  rig.pad(CIRCLE, false);

  const core = rig.attachCore();
  assert.equal(rig.api.ensureInstalled(), true);
  assert.deepEqual(sorted(core.take()), [[SQUARE, 1], [TRIANGLE, 1]]);
  assert.deepEqual(rig.state().charging, [TRIANGLE, SQUARE]);
});
