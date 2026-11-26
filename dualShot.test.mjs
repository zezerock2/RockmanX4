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
  "./autoCharge": compile("../src/lib/autoCharge.ts"),
  "./patches": compile("../src/lib/patches.ts"),
};

const SQUARE = 1;
const TRIANGLE = 9;
const ARMOR = "30141A4F 000F";
const STOCK = "30141A60 0001";
const PLASMA = "30141A60 0002";
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Both real modules in one sandbox, a fake clock, and a fake EmulatorJS.
 * `events` is the single ordered record of everything the emulated game is told:
 *   ["pad", buttonIndex, value]  – a pad press (1) or release (0)
 *   ["cheat", slot, on, code]    – a cheat switched off or on
 */
function rig(seed = {}) {
  const storage = new Map(Object.entries(seed));
  let clock = 10_000;
  let nextId = 1;
  const timers = new Map();
  const events = [];
  const memory = { pad: new Map(), cheat: new Map() };

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

  const emulator = {
    cheats: [],
    gameManager: {
      simulateInput: (player, index, value) => {
        events.push(["pad", index, value]);
        memory.pad.set(index, value);
      },
      setCheat: (index, enabled, code) => {
        events.push(["cheat", index, enabled, code]);
        if (enabled) memory.cheat.set(index, code);
        else memory.cheat.delete(index);
      },
    },
    cheatChanged(enabled, code, index) {
      assert.equal(this, emulator, "cheatChanged must keep its receiver");
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
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    Date: { now: () => clock },
  });
  context.require = (name) => {
    if (cache[name]) return cache[name];
    const exports = {};
    runInContext(`(function (exports, require) {${source[name]}\n})`, context)(exports, context.require);
    return (cache[name] = exports);
  };
  const charge = context.require("./autoCharge");
  const patches = context.require("./patches");

  // the host wires the two modules together exactly like Player.tsx does
  charge.setBeforeFire((index) => {
    const now = patches.patches.getSnapshot();
    if (now.game !== "x4" || now.chargeShotMode !== "perButton") return true;
    const button = index === SQUARE ? "square" : index === TRIANGLE ? "triangle" : null;
    if (!button || !now.enabled.includes("buster-type")) return true;
    return patches.setLiveShot(patches.patches.shotForButton(button));
  });

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

  return {
    charge: charge.autoCharge,
    patches: patches.patches,
    setLiveShot: patches.setLiveShot,
    emulator,
    storage,
    advance,
    /** forget everything recorded so far */
    reset: () => (events.length = 0),
    /** everything recorded since the last reset(), in order */
    log: () => events.slice(),
    /** only the pad events since the last reset(), as [button, value] */
    pad: () => events.filter((e) => e[0] === "pad").map((e) => [e[1], e[2]]),
    /** only the cheat events since the last reset(), as [on, code] */
    cheats: () => events.filter((e) => e[0] === "cheat").map((e) => [e[2], e[3]]),
    /** cheat codes the emulated game currently has active */
    liveCodes: () => [...memory.cheat.values()].sort(),
    /** buttons the emulated game currently sees as held down */
    held: () => [...memory.pad.entries()].filter(([, v]) => v === 1).map(([i]) => i).sort(),
    key: (index, down) => emulator.gameManager.simulateInput(0, index, down ? 1 : 0),
    boot() {
      charge.ensureInstalled();
      patches.syncPatches();
    },
  };
}

/** A game of X4 with the armour + arm part on and 雙開 charging, ready to play. */
function ready(seed = {}) {
  const r = rig(seed);
  r.boot();
  r.patches.set("fourth-armor", true);
  r.patches.set("buster-type", true);
  r.charge.setEnabled(true);
  r.charge.toggleDual();
  r.reset();
  return r;
}

const withMode = (seed) => {
  const r = ready(seed);
  r.patches.setChargeShotMode("perButton");
  r.reset();
  return r;
};

/** press a button, let it fire, let go, let it charge again */
function fireOnce(r, index) {
  r.key(index, true);
  r.advance(400);
  r.key(index, false);
  r.advance(150);
}

/* ------------------------------------------------------------------ */
/*  mode + assignment                                                  */
/* ------------------------------------------------------------------ */

test("default is one arm part for both buttons", () => {
  const r = ready();
  assert.equal(r.patches.getSnapshot().chargeShotMode, "single");
  assert.equal(r.patches.shotForButton("square"), "plasma");
  assert.equal(r.patches.shotForButton("triangle"), "plasma");
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA]);
});

test("雙彈種 defaults to □ = 四連發, △ = 電漿炮", () => {
  const r = withMode();
  const s = r.patches.getSnapshot();
  assert.equal(s.chargeShotMode, "perButton");
  assert.equal(s.squareShot, "stock");
  assert.equal(s.triangleShot, "plasma");
  assert.equal(r.patches.shotForButton("square"), "stock");
  assert.equal(r.patches.shotForButton("triangle"), "plasma");
  assert.deepEqual(r.cheats(), [], "nothing is written until a button asks for it");
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA]);
});

test("either button can take either arm part", () => {
  const r = withMode();
  r.patches.setButtonShot("square", "plasma");
  r.patches.setButtonShot("triangle", "stock");
  assert.equal(r.patches.shotForButton("square"), "plasma");
  assert.equal(r.patches.shotForButton("triangle"), "stock");
  r.patches.setButtonShot("square", "stock");
  assert.equal(r.patches.shotForButton("square"), "stock");
  assert.equal(r.patches.shotForButton("triangle"), "stock", "the same one on both is allowed");
});

test("back to single mode: both buttons follow the single choice", () => {
  const r = ready();
  r.patches.setChargeShot("stock");
  r.patches.setChargeShotMode("perButton");
  r.patches.setButtonShot("triangle", "plasma");
  r.patches.setChargeShotMode("single");
  assert.equal(r.patches.shotForButton("square"), "stock");
  assert.equal(r.patches.shotForButton("triangle"), "stock");
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK]);
});

test("bad values for mode and assignment are refused", () => {
  const r = withMode();
  r.patches.setChargeShotMode("both");
  assert.equal(r.patches.getSnapshot().chargeShotMode, "perButton");
  r.patches.setButtonShot("circle", "plasma");
  r.patches.setButtonShot("square", "laser");
  r.patches.setButtonShot("square", 7);
  assert.equal(r.patches.getSnapshot().squareShot, "stock");
  assert.equal(r.patches.getSnapshot().triangleShot, "plasma");
});

/* ------------------------------------------------------------------ */
/*  the point of the feature                                           */
/* ------------------------------------------------------------------ */

test("□ fires 四連發 and △ fires 電漿炮", () => {
  const r = withMode();
  assert.deepEqual(r.held(), [SQUARE, TRIANGLE], "both charging");

  r.key(SQUARE, true);
  assert.deepEqual(r.cheats(), [[false, PLASMA], [true, STOCK]], "arm part becomes 四連發");
  assert.deepEqual(r.pad(), [[SQUARE, 0]], "then □ is released, firing a 四連發 shot");
  assert.deepEqual(r.held(), [TRIANGLE], "△ never let go");
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK]);
  r.advance(400);
  r.key(SQUARE, false);
  assert.deepEqual(r.held(), [SQUARE, TRIANGLE], "□ charges again");

  r.reset();
  r.key(TRIANGLE, true);
  assert.deepEqual(r.cheats(), [[false, STOCK], [true, PLASMA]], "arm part becomes 電漿炮");
  assert.deepEqual(r.pad(), [[TRIANGLE, 0]], "then △ is released, firing a 電漿炮");
  assert.deepEqual(r.held(), [SQUARE], "□ keeps charging");
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA]);
});

test("the arm part is always rewritten BEFORE the button is released", () => {
  const r = withMode();
  let round = 0;
  for (const index of [SQUARE, TRIANGLE, SQUARE, TRIANGLE, SQUARE]) {
    round += 1;
    r.reset();
    r.key(index, true);
    const seen = r.log();
    const release = seen.findIndex((e) => e[0] === "pad" && e[1] === index && e[2] === 0);
    const enabled = seen.findLastIndex((e) => e[0] === "cheat" && e[2] === true);
    assert.ok(release >= 0, `round ${round}: the button was released`);
    assert.ok(enabled >= 0, `round ${round}: an arm part was written; saw ${JSON.stringify(seen)}`);
    assert.ok(enabled < release, `arm part (event ${enabled}) must precede the release (event ${release})`);
    assert.equal(seen[enabled][3], index === SQUARE ? STOCK : PLASMA, "and it is this button's own arm part");
    r.advance(400);
    r.key(index, false);
    r.advance(150);
  }
});

test("in single mode both buttons keep firing the same arm part", () => {
  const r = ready();
  r.patches.setChargeShot("stock");
  for (const index of [SQUARE, TRIANGLE]) {
    r.reset();
    r.key(index, true);
    assert.deepEqual(r.cheats(), [], "no arm part is swapped in single mode");
    assert.deepEqual(r.pad(), [[index, 0]]);
    assert.deepEqual(r.liveCodes(), [ARMOR, STOCK]);
    r.advance(400);
    r.key(index, false);
    r.advance(150);
  }
});

test("both pressed together: the last one pressed decides the arm part", () => {
  const r = withMode();
  r.key(SQUARE, true);
  r.key(TRIANGLE, true);
  assert.deepEqual(r.held(), [], "both released to fire");
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA], "△ was pressed last, so 電漿炮 is live");
  r.advance(200);
  r.key(SQUARE, false);
  r.key(TRIANGLE, false);
  r.advance(200);
  assert.deepEqual(r.held(), [SQUARE, TRIANGLE]);
});

/* ------------------------------------------------------------------ */
/*  the switch is cheap and safe                                       */
/* ------------------------------------------------------------------ */

test("the switch rewrites one slot in place and never moves the others", () => {
  const r = withMode();
  const before = r.emulator.cheats.map((entry) => entry.desc);
  const slot = r.emulator.cheats.findIndex((entry) => entry.desc === "集氣彈種類");
  r.key(SQUARE, true);
  const touched = r.log().filter((e) => e[0] === "cheat").map((e) => e[1]);
  assert.deepEqual(touched, [slot, slot], "only the arm-type slot, at the same index");
  assert.deepEqual(r.emulator.cheats.map((entry) => entry.desc), before, "no slot added or removed");
  assert.equal(r.emulator.cheats[slot].checked, true);
  assert.equal(r.emulator.cheats[slot].code, STOCK);
});

test("the switch does not redraw EmulatorJS' cheat menu", () => {
  const r = withMode();
  let redraws = 0;
  r.emulator.updateCheatUI = () => redraws++;
  fireOnce(r, SQUARE);
  fireOnce(r, TRIANGLE);
  fireOnce(r, SQUARE);
  assert.equal(redraws, 0, "input events must not trigger a menu redraw");
});

test("asking for the arm part that is already live writes nothing", () => {
  const r = withMode();
  r.patches.setButtonShot("square", "plasma");
  r.key(SQUARE, true);
  assert.deepEqual(r.cheats(), [], "already 電漿炮: nothing to switch");
  assert.deepEqual(r.pad(), [[SQUARE, 0]], "the shot still fires");
});

test("repeated switching never leaves two arm types active", () => {
  const r = withMode();
  for (let i = 0; i < 40; i++) {
    const index = i % 2 ? TRIANGLE : SQUARE;
    r.key(index, true);
    assert.equal(r.liveCodes().filter((code) => code.startsWith("30141A60")).length, 1);
    assert.equal(r.emulator.cheats.length, 7, "no new slots appear");
    r.advance(150);
    r.key(index, false);
    r.advance(150);
  }
});

/* ------------------------------------------------------------------ */
/*  when the switch cannot happen                                      */
/* ------------------------------------------------------------------ */

test("with the arm-part patch off, buttons still fire and nothing is switched", () => {
  const r = withMode();
  r.patches.set("buster-type", false);
  r.reset();
  r.key(SQUARE, true);
  assert.deepEqual(r.cheats(), []);
  assert.deepEqual(r.pad(), [[SQUARE, 0]], "the shot still fires");
  assert.deepEqual(r.held(), [TRIANGLE]);
});

test("if the core refuses the switch, the shot waits instead of firing the wrong arm part", () => {
  const r = withMode();
  const setCheat = r.emulator.gameManager.setCheat;
  r.emulator.gameManager.setCheat = () => {
    throw new Error("core busy");
  };
  r.key(SQUARE, true);
  assert.deepEqual(r.pad(), [], "still held: no wrong shot escapes");
  assert.deepEqual(plain(r.charge.getSnapshot().pending), [SQUARE]);
  assert.deepEqual(r.held(), [SQUARE, TRIANGLE]);

  r.emulator.gameManager.setCheat = setCheat;
  r.charge.retryPending();
  const retry = r.log();
  const switched = retry.filter((e) => e[0] === "cheat");
  assert.equal(switched.length >= 2, true, "the arm part was switched off and on again");
  assert.deepEqual([switched.at(-2)[2], switched.at(-2)[3]], [false, PLASMA]);
  assert.deepEqual([switched.at(-1)[2], switched.at(-1)[3]], [true, STOCK]);
  assert.deepEqual(retry.filter((e) => e[0] === "pad").at(-1), ["pad", SQUARE, 0], "then □ fires, with the right arm part");
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK]);
  assert.deepEqual(plain(r.charge.getSnapshot().pending), []);
});

test("REGRESSION: a failed switch must never be mistaken for done", () => {
  // Before the fix, liveShot was updated before the core write. When the write
  // failed, the retry saw "already live" and fired – with the OLD arm part.
  const r = withMode();
  r.patches.setButtonShot("triangle", "stock");
  r.key(TRIANGLE, true); // plasma -> stock, fine
  r.advance(400);
  r.key(TRIANGLE, false);
  r.advance(150);
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK]);

  // now △ would switch back to… no: make △ plasma again and have the core refuse
  r.patches.setButtonShot("triangle", "plasma");
  const setCheat = r.emulator.gameManager.setCheat;
  r.emulator.gameManager.setCheat = () => {
    throw new Error("core busy");
  };
  r.reset();
  r.key(TRIANGLE, true);
  assert.deepEqual(r.pad(), [], "nothing fired while the switch was refused");
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK], "the game still has the previous arm part");
  assert.equal(r.patches.getSnapshot().liveShot, "stock", "and liveShot honestly says so");

  r.emulator.gameManager.setCheat = setCheat;
  r.reset();
  r.charge.retryPending();
  const switched = r.log().filter((e) => e[0] === "cheat");
  assert.equal(switched.length, 2, "the retry actually rewrites the arm part");
  assert.deepEqual([switched[0][2], switched[0][3]], [false, STOCK]);
  assert.deepEqual([switched[1][2], switched[1][3]], [true, PLASMA]);
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA], "so the shot goes out with the right one");
});

test("a button let go while it was waiting does not fire later", () => {
  const r = withMode();
  const setCheat = r.emulator.gameManager.setCheat;
  r.emulator.gameManager.setCheat = () => {
    throw new Error("core busy");
  };
  r.key(SQUARE, true);
  r.emulator.gameManager.setCheat = setCheat;
  r.reset();
  r.key(SQUARE, false);
  r.charge.retryPending();
  assert.deepEqual(r.pad().filter(([, v]) => v === 0), [], "nothing was fired after the press was over");
  assert.deepEqual(r.held(), [SQUARE, TRIANGLE], "and it is charging again");
});

/* ------------------------------------------------------------------ */
/*  persistence and the rest of the app                                */
/* ------------------------------------------------------------------ */

test("mode and both assignments survive a fresh load", () => {
  const first = withMode();
  first.patches.setButtonShot("square", "plasma");
  first.patches.setButtonShot("triangle", "stock");
  const next = rig(Object.fromEntries(first.storage));
  next.boot();
  const s = next.patches.getSnapshot();
  assert.equal(s.chargeShotMode, "perButton");
  assert.equal(s.squareShot, "plasma");
  assert.equal(s.triangleShot, "stock");
  assert.deepEqual(plain(s.enabled), ["fourth-armor", "buster-type"]);
  assert.deepEqual(next.held(), [SQUARE, TRIANGLE], "雙開 was remembered too");
});

test("a half-saved assignment falls back to its own default", () => {
  const r = rig({
    "ps1web.patches.chargeShotMode": "perButton",
    "ps1web.patches.squareShot": "laser",
  });
  r.boot();
  const s = r.patches.getSnapshot();
  assert.equal(s.squareShot, "stock", "invalid value -> default");
  assert.equal(s.triangleShot, "plasma", "missing value -> default");
  assert.equal(s.chargeShotMode, "perButton");
});

test("an old two-line armour cheat from the previous build is folded in cleanly", () => {
  const r = rig({ "ps1web.patches.on.x4": '["fourth-armor","buster-type"]', "ps1web.patches.chargeShot": "stock" });
  r.emulator.cheats = [{ desc: "開局第四裝甲", code: `${ARMOR}+${PLASMA}`, checked: true, is_permanent: true }];
  r.boot();
  r.charge.setEnabled(true);
  r.charge.toggleDual();
  r.patches.setChargeShotMode("perButton");
  r.reset();
  r.key(TRIANGLE, true);
  assert.deepEqual(r.liveCodes(), [ARMOR, PLASMA], "one armour write and exactly one arm type");
  assert.equal(r.emulator.cheats[0].code, ARMOR, "the old slot was rewritten to the single-line code");
});

test("turning 雙開 off, or auto-charge off (manual 自行集氣), still enables per-button switching on press", () => {
  const r = withMode();
  // Live starts as PLASMA in withMode()
  // When pressing SQUARE manually, it switches live to STOCK
  r.key(SQUARE, true);
  r.key(SQUARE, false);

  // Now live is STOCK. Turn 雙開 off (only SQUARE is managed by auto-charge, TRIANGLE is unmanaged/manual)
  r.charge.toggleDual();
  r.reset();

  // In manual or unmanaged mode, pressing TRIANGLE directly flips to PLASMA!
  r.key(TRIANGLE, true);
  assert.deepEqual(r.cheats(), [[false, STOCK], [true, PLASMA]], "manual press also switches arm part!");
  assert.deepEqual(r.pad(), [[TRIANGLE, 1]], "it passes through to the game");

  // Fully disable auto-charge (all buttons are manual 自行集氣)
  r.charge.setEnabled(false);
  r.reset();
  // Pressing SQUARE manually flips from PLASMA back to STOCK!
  r.key(SQUARE, true);
  assert.deepEqual(r.cheats(), [[false, PLASMA], [true, STOCK]], "manual press of SQUARE switches to STOCK!");
  assert.deepEqual(r.liveCodes(), [ARMOR, STOCK], "the arm part is live as STOCK");
});

test("雙彈種 has no effect on X5", () => {
  const r = rig({ "ps1web.patches.game": "x5", "ps1web.patches.chargeShot": "plasma" });
  r.boot();
  r.patches.setChargeShotMode("perButton");
  assert.equal(r.patches.getSnapshot().game, "x5");
  assert.equal(r.patches.shotForButton("square"), "plasma", "X5 reports the stored single choice");
  r.charge.setEnabled(true);
  r.charge.toggleDual();
  r.reset();
  r.key(SQUARE, true);
  assert.deepEqual(r.cheats(), []);
  assert.deepEqual(r.liveCodes(), [], "no X4 address is ever written");
});
