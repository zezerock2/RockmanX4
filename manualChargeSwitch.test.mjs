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
const STOCK = "30141A60 0001";
const PLASMA = "30141A60 0002";

function boot() {
  let clock = 10_000;
  const inputLog = [];
  const cheatLog = [];

  const window = {
    addEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const document = { hidden: false, addEventListener() {} };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  const emulator = {
    cheats: [],
    gameManager: {
      simulateInput: (player, index, value) => {
        inputLog.push({ index, value });
      },
      setCheat: (index, enabled, code) => {
        cheatLog.push({ index, enabled, code });
      },
    },
    cheatChanged(enabled, code, index) {
      this.gameManager.setCheat(index, enabled, code);
    },
    menu: { toggle() {} },
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

  const patches = context.require("./patches");
  const charge = context.require("./autoCharge");

  emulator.cheats = patches.getPatchCheats().map(([desc, code]) => ({
    desc,
    code,
    checked: false,
    is_permanent: true,
  }));

  // Initial state: Auto-charge is DISABLED (自行集氣), per-button mode is active
  charge.autoCharge.setEnabled(false);
  patches.patches.set("buster-type", true);
  patches.patches.setChargeShotMode("perButton");
  charge.ensureInstalled();
  patches.syncPatches();

  cheatLog.length = 0;
  inputLog.length = 0;

  return {
    charge: charge.autoCharge,
    patches: patches.patches,
    emulator,
    cheatLog,
    inputLog,
    // Keyboard / controller input
    key: (index, down) => emulator.gameManager.simulateInput(0, index, down ? 1 : 0),
    // Virtual on-screen touch pad
    pad: (index, down) => charge.padInput(index, down ? 1 : 0),
  };
}

test("Manual charging (自行集氣) with keyboard: pressing SQUARE switches to STOCK before game receives press", () => {
  const r = boot();
  // Press SQUARE on keyboard
  r.key(SQUARE, true);

  // Assert cheat was updated to STOCK
  const activeCheats = r.cheatLog.filter((c) => c.enabled);
  assert.ok(activeCheats.length > 0, "Cheat should be set when pressing SQUARE");
  assert.equal(activeCheats[activeCheats.length - 1].code, STOCK, "Should switch to Stock Charge for SQUARE");

  // Release SQUARE
  r.key(SQUARE, false);
});

test("Manual charging (自行集氣) with keyboard: pressing TRIANGLE switches to PLASMA before game receives press", () => {
  const r = boot();
  // First press SQUARE to switch active to STOCK
  r.key(SQUARE, true);
  r.key(SQUARE, false);

  // Then press TRIANGLE on keyboard
  r.cheatLog.length = 0;
  r.key(TRIANGLE, true);

  // Assert cheat was updated to PLASMA
  const activeCheats = r.cheatLog.filter((c) => c.enabled);
  assert.ok(activeCheats.length > 0, "Cheat should be set when pressing TRIANGLE");
  assert.equal(activeCheats[activeCheats.length - 1].code, PLASMA, "Should switch to Plasma Charge for TRIANGLE");

  // Release TRIANGLE
  r.key(TRIANGLE, false);
});

test("Manual charging (自行集氣) with on-screen Virtual Pad: switches arm parts appropriately", () => {
  const r = boot();

  // Touch SQUARE on virtual pad
  r.pad(SQUARE, true);
  let active = r.cheatLog.filter((c) => c.enabled);
  assert.equal(active[active.length - 1].code, STOCK, "Virtual pad SQUARE switches to STOCK");
  r.pad(SQUARE, false);

  // Touch TRIANGLE on virtual pad
  r.pad(TRIANGLE, true);
  active = r.cheatLog.filter((c) => c.enabled);
  assert.equal(active[active.length - 1].code, PLASMA, "Virtual pad TRIANGLE switches to PLASMA");
  r.pad(TRIANGLE, false);
});
