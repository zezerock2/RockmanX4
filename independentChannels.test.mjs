import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

const source = {
  "./buttons": compile("../src/lib/buttons.ts"),
  "./patches": compile("../src/lib/patches.ts"),
  "./autoCharge": compile("../src/lib/autoCharge.ts"),
};

const SQUARE = 1;
const TRIANGLE = 9;

function boot() {
  let clock = 10_000;
  let nextId = 1;
  const timers = new Map();
  const inputLog = [];

  const window = {
    addEventListener() {},
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: clock + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const document = { hidden: false, addEventListener() {} };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  const emulator = {
    gameManager: {
      simulateInput: (player, index, value) => {
        inputLog.push({ index, value, time: clock });
      },
    },
  };
  window.EJS_emulator = emulator;

  const cache = {};
  const context = createContext({
    exports: {},
    window,
    document,
    localStorage,
    Date: { now: () => clock },
  });
  context.require = (name) => {
    if (cache[name]) return cache[name];
    const exports = {};
    runInContext(`(function (exports, require) {${source[name]}\n})`, context)(exports, context.require);
    return (cache[name] = exports);
  };
  const charge = context.require("./autoCharge");

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

  charge.autoCharge.setEnabled(true);
  charge.autoCharge.toggleDual();
  charge.ensureInstalled();
  inputLog.length = 0;

  return {
    charge: charge.autoCharge,
    advance,
    log: inputLog,
    key: (index, down) => emulator.gameManager.simulateInput(0, index, down ? 1 : 0),
    clear: () => (inputLog.length = 0),
  };
}

test("Type B independence: firing SQUARE has zero events on TRIANGLE", () => {
  const r = boot();
  // Press SQUARE to fire
  r.key(SQUARE, true);
  // TRIANGLE should NOT receive any events whatsoever
  const triangleEvents = r.log.filter((e) => e.index === TRIANGLE);
  assert.equal(triangleEvents.length, 0, "TRIANGLE was never interrupted");
  assert.deepEqual(r.log.map((e) => [e.index, e.value]), [[SQUARE, 0]]);
  
  // Advance 20ms and release SQUARE
  r.advance(20);
  r.key(SQUARE, false);
  r.advance(90); // Total 110ms (exceeds MIN_RELEASE_MS + 5ms buffer)
  // SQUARE should resume charging (value 1)
  assert.deepEqual(
    r.log.map((e) => [e.index, e.value]),
    [[SQUARE, 0], [SQUARE, 1]]
  );
  // TRIANGLE still untouched
  assert.equal(r.log.filter((e) => e.index === TRIANGLE).length, 0);
});

test("Type B independence: firing TRIANGLE has zero events on SQUARE", () => {
  const r = boot();
  r.key(TRIANGLE, true);
  const squareEvents = r.log.filter((e) => e.index === SQUARE);
  assert.equal(squareEvents.length, 0, "SQUARE was never interrupted");
  assert.deepEqual(r.log.map((e) => [e.index, e.value]), [[TRIANGLE, 0]]);

  r.advance(20);
  r.key(TRIANGLE, false);
  r.advance(90);
  assert.deepEqual(
    r.log.map((e) => [e.index, e.value]),
    [[TRIANGLE, 0], [TRIANGLE, 1]]
  );
  assert.equal(r.log.filter((e) => e.index === SQUARE).length, 0);
});

test("Type B independence: holding one while repeatedly firing the other", () => {
  const r = boot();
  // Hold SQUARE (fires charge shot, stays 0)
  r.key(SQUARE, true);
  assert.deepEqual(r.log.map((e) => [e.index, e.value]), [[SQUARE, 0]]);
  r.clear();

  // Fire TRIANGLE multiple times while SQUARE is being held
  for (let i = 0; i < 3; i++) {
    r.key(TRIANGLE, true);
    r.advance(30);
    r.key(TRIANGLE, false);
    r.advance(80);
  }

  // SQUARE should NEVER have been triggered or released
  const squareTouches = r.log.filter((e) => e.index === SQUARE);
  assert.equal(squareTouches.length, 0, "SQUARE was completely untouched during TRIANGLE fires");

  // Now release SQUARE after holding it
  r.key(SQUARE, false);
  r.advance(10);
  const finalSquare = r.log.filter((e) => e.index === SQUARE);
  assert.deepEqual(finalSquare.map((e) => [e.index, e.value]), [[SQUARE, 1]]);
});
