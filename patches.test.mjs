import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/patches.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const ARMOR = "30141A4F 000F";
const STOCK = `${ARMOR}+30141A60 0001`;
const PLASMA = `${ARMOR}+30141A60 0002`;
const X5_ALL_ARMORS = "300D3122 001F+300D3179 00FF";
const GAME_KEY = "ps1web.patches.game";
const SHOT_KEY = "ps1web.patches.chargeShot";
const LEGACY = "ps1web.patches.on";
const enabledKey = (game) => `ps1web.patches.on.${game}`;
const plain = (value) => JSON.parse(JSON.stringify(value));

function runtime(seed = {}, { storageBlocked = false } = {}) {
  const storage = new Map(Object.entries(seed));
  const context = {
    exports: {},
    window: {},
    localStorage: {
      getItem(key) {
        if (storageBlocked) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageBlocked) throw new Error("Storage blocked");
        storage.set(key, value);
      },
    },
  };
  runInNewContext(compiled, context);
  const api = context.exports;

  function attach(entries) {
    const calls = [];
    const core = new Map();
    const menu = [];
    const emulator = {
      cheats: entries ?? plain(api.getPatchCheats()).map(([desc, code]) => ({
        desc, code, checked: false, is_permanent: true,
      })),
      gameManager: {
        setCheat(index, enabled, code) {
          calls.push({ index, enabled, code });
          core.set(index, { enabled, code });
        },
      },
      cheatChanged(enabled, code, index) {
        assert.equal(this, emulator, "cheatChanged must retain its receiver");
        this.gameManager.setCheat(index, enabled, code);
      },
      updateCheatUI() {
        core.clear();
        menu.splice(0);
        this.cheats.forEach((entry, index) => {
          menu.push({ code: entry.code, checked: Boolean(entry.checked) });
          this.cheatChanged(Boolean(entry.checked), entry.code, index);
        });
      },
    };
    context.window.EJS_emulator = emulator;
    return { emulator, calls, core, menu };
  }

  return { api, storage, attach };
}

/** The armour together with its arm part, which is how the UI switches them on. */
function enableArmour(rig, shot = "plasma") {
  rig.api.patches.setChargeShot(shot);
  rig.api.patches.set("fourth-armor", true);
  rig.api.patches.set("buster-type", true);
}
const armourOn = (seed = {}) => JSON.stringify(["fourth-armor", ...(seed.buster === false ? [] : ["buster-type"])]);

const active = (core) => [...core.values()].filter((slot) => slot.enabled).map((slot) => slot.code);

test("detects the game from file names", () => {
  const { api } = runtime();
  assert.equal(api.detectGame("Rockman X4 (Japan).bin"), "x4");
  assert.equal(api.detectGame("[SLPM-86666] Rockman X5 (J)"), "x5");
  assert.equal(api.detectGame("MMX5.cue"), "x5");
  assert.equal(api.detectGame("洛克人X4.chd"), "x4");
  assert.equal(api.detectGame("disc1.bin"), null);
  assert.equal(api.detectGame(""), null);
});

test("defaults to X4 with plasma and keeps the legacy enabled list", () => {
  const { api } = runtime({ [LEGACY]: '["fourth-armor","infinite-hover"]' });
  const snapshot = api.patches.getSnapshot();
  assert.equal(snapshot.game, "x4");
  assert.equal(snapshot.detected, null);
  assert.equal(snapshot.chargeShot, "plasma");
  assert.deepEqual(plain(snapshot.enabled), ["fourth-armor", "infinite-hover"]);
  assert.equal(api.getPatchCheats()[0][1], ARMOR, "armour cheat carries no buster type any more");
  assert.equal(api.getPatchCheats()[1][1], "30141A60 0002", "the arm-type cheat holds the selection");
});

test("X4 offers the fourth armor and its assists; X5 offers the falcon armor", () => {
  const { api } = runtime();
  assert.deepEqual(
    plain(api.patchesFor("x4").map((patch) => patch.id)),
    ["fourth-armor", "buster-type", "air-limit", "infinite-hover", "charge-shot", "charge-special", "falcon-armor-x4"],
  );
  assert.deepEqual(
    plain(api.patchesFor("x5").map((patch) => patch.id)),
    ["falcon-armor", "x5-falcon-equip", "x5-gaea-equip", "x5-infinite-flight", "x5-no-limit", "x5-charge-shot", "x5-charge-special", "x5-air-limit"],
  );
  assert.equal(api.patchesFor("x5")[0].code, X5_ALL_ARMORS);
  assert.equal(api.PATCHES.every((patch) => patch.game === "x4" || patch.game === "x5"), true);
});

test("X4 cross-gen Falcon: the outfit choice adds the hidden flag and rewrites the slot in place", () => {
  const BASE = "30141A4F 000F+30141A2E 0000+30141A7D 00FF";
  const ULTIMATE = `${BASE}+301722AF 000F`;
  const { api, attach, storage } = runtime({ "ps1web.patches.on.x4": '["falcon-armor-x4"]' });
  const falcon = api.PATCHES.find((patch) => patch.id === "falcon-armor-x4");
  assert.equal(api.X4_FALCON_BASE, BASE);
  assert.equal(api.X4_HIDDEN_FLAG_CODE, "301722AF 000F");
  assert.equal(api.patches.getSnapshot().x4Outfit, "fourth", "defaults to the Fourth armour look");
  assert.equal(api.resolvePatch(falcon).code, BASE);
  assert.equal(api.resolvePatch(falcon, "plasma", "ultimate").code, ULTIMATE);
  assert.equal(falcon.code, BASE, "resolving must not mutate the base definition");
  assert.match(falcon.title, /獵鷹外型能力/);

  const { core, emulator } = attach();
  api.syncPatches();
  const slot = emulator.cheats.findIndex((entry) => entry.desc === falcon.title);
  assert.deepEqual(core.get(slot), { enabled: true, code: BASE });

  api.patches.setX4Outfit("ultimate");
  assert.deepEqual(core.get(slot), { enabled: true, code: ULTIMATE }, "same slot, new code");
  assert.equal(emulator.cheats.length, 7, "no new slots appear");
  assert.equal(storage.get("ps1web.patches.x4Outfit"), "ultimate");
  assert.equal([...core.values()].filter((entry) => entry.enabled && entry.code === BASE).length, 0, "the old variant is not left live");

  api.patches.setX4Outfit("ultimate");
  api.patches.setX4Outfit("bad");
  assert.equal(api.patches.getSnapshot().x4Outfit, "ultimate", "unknown values are ignored");

  api.patches.setX4Outfit("fourth");
  assert.deepEqual(core.get(slot), { enabled: true, code: BASE });

  // the choice survives a reload, and a stale ultimate entry is recognised as ours
  const next = runtime({ ...Object.fromEntries(storage), "ps1web.patches.x4Outfit": "ultimate" });
  const reattached = next.attach([{ desc: "舊的", code: ULTIMATE, checked: true }]);
  next.api.syncPatches();
  assert.equal(reattached.emulator.cheats.filter((entry) => entry.code === ULTIMATE).length, 1, "folded into one slot");
  assert.deepEqual(reattached.emulator.cheats[0].appPatchId, "falcon-armor-x4");
});

test("額外寫入: extras append in table order, rewrite the same slot, persist, and are recognised", () => {
  const BASE = "30141A4F 000F+30141A2E 0000+30141A7D 00FF";
  const { api, attach, storage } = runtime({ "ps1web.patches.on.x4": '["falcon-armor-x4"]' });
  assert.deepEqual(
    plain(api.X4_EXTRA_WRITES.map((extra) => [extra.id, extra.code])),
    [
      ["afterimage", "30141A34 0001"],
      ["dash-distance", "30141A2D 0000"],
      ["air-speed", "30141A2C 0001"],
      ["no-stiffness", "30141A3A 0000"],
      ["shot-limit", "30141A40 0000"],
      ["invincible", "30141A7A 0001"],
    ],
    "the five X4 writes from the PTT list plus the experimental invincible flag, no X5 addresses",
  );
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), [], "opt-in: nothing extra by default");
  assert.deepEqual(
    plain(api.X4_EXTRA_GROUPS.map((group) => group.id)),
    ["ability", "appearance"],
    "extras render in ability/appearance groups",
  );
  assert.deepEqual(
    plain(api.X4_EXTRA_WRITES.map((extra) => [extra.id, extra.group])),
    [
      ["afterimage", "appearance"],
      ["dash-distance", "ability"],
      ["air-speed", "ability"],
      ["no-stiffness", "ability"],
      ["shot-limit", "ability"],
      ["invincible", "ability"],
    ],
  );
  assert.equal(
    api.X4_EXTRA_WRITES.every((extra) => typeof extra.falcon === "string" && extra.falcon.length > 0),
    true,
    "every extra names the Falcon trait it reproduces",
  );

  const { core, emulator } = attach();
  api.syncPatches();
  const slot = emulator.cheats.findIndex((entry) => entry.appPatchId === "falcon-armor-x4");
  assert.deepEqual(core.get(slot), { enabled: true, code: BASE });

  // click order is shot-limit first, then afterimage: the code still follows the table order
  api.patches.setX4Extra("shot-limit", true);
  api.patches.setX4Extra("afterimage", true);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), ["afterimage", "shot-limit"]);
  const TWO = `${BASE}+30141A34 0001+30141A40 0000`;
  assert.deepEqual(core.get(slot), { enabled: true, code: TWO }, "same slot, extras appended");
  assert.equal(emulator.cheats.length, 7, "extras never take a slot of their own");
  assert.equal([...core.values()].filter((entry) => entry.enabled).length, 1, "no stale variant stays live");
  assert.equal(storage.get("ps1web.patches.x4Extras"), '["afterimage","shot-limit"]');

  api.patches.setX4Extra("afterimage", true);
  api.patches.setX4Extra("nope", true);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), ["afterimage", "shot-limit"], "idempotent; unknown ids ignored");

  // outfit and extras combine: outfit flag first, then extras
  api.patches.setX4Outfit("ultimate");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+301722AF 000F+30141A34 0001+30141A40 0000` });
  api.patches.setX4Outfit("fourth");
  api.patches.setX4Extra("shot-limit", false);
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+30141A34 0001` });

  // a reload keeps the choice, and a slot carrying any extras combination is ours
  const next = runtime(Object.fromEntries(storage));
  assert.deepEqual(plain(next.api.patches.getSnapshot().x4Extras), ["afterimage"]);
  const stale = `${BASE}+301722AF 000F+30141A2D 0000+30141A2C 0001+30141A3A 0000`;
  const reattached = next.attach([{ desc: "舊的", code: stale, checked: true }]);
  next.api.syncPatches();
  assert.equal(reattached.emulator.cheats[0].appPatchId, "falcon-armor-x4", "recognised by its code alone");
  assert.equal(reattached.emulator.cheats[0].code, `${BASE}+30141A34 0001`, "rewritten to the current choice");
  assert.equal(reattached.emulator.cheats.filter((entry) => entry.appPatchId === "falcon-armor-x4").length, 1);
});

test("額外寫入批量: setX4Extras normalises order, drops unknown ids, and is a no-op when unchanged", () => {
  const BASE = "30141A4F 000F+30141A2E 0000+30141A7D 00FF";
  const { api, attach, storage } = runtime({ "ps1web.patches.on.x4": '["falcon-armor-x4"]' });
  const { core, emulator } = attach();
  const falconTitle = api.PATCHES.find((patch) => patch.id === "falcon-armor-x4").title;
  const slot = emulator.cheats.findIndex((entry) => entry.desc === falconTitle);
  api.syncPatches();

  api.patches.setX4Extras(["shot-limit", "afterimage", "nope", "dash-distance"]);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), ["afterimage", "dash-distance", "shot-limit"], "table order; unknown ids dropped");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+30141A34 0001+30141A2D 0000+30141A40 0000` });
  assert.equal(storage.get("ps1web.patches.x4Extras"), '["afterimage","dash-distance","shot-limit"]');

  api.patches.setX4Extras(["afterimage", "dash-distance", "shot-limit"]);
  assert.equal(api.patches.getSnapshot().applied, true, "same choice: no re-publish, state stays applied");

  api.patches.setX4Extras([]);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), []);
  assert.deepEqual(core.get(slot), { enabled: true, code: BASE }, "back to the base flight code");
});

test("the X4 Falcon preset switches the recommended 額外寫入 on but leaves air-speed to the player", () => {
  const { api, attach } = runtime();
  const { core } = attach();
  assert.equal(api.patches.falconPresetEnabled(), false);
  assert.equal(api.patches.setFalconPreset(true), true);
  assert.equal(api.patches.falconPresetEnabled(), true);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), ["afterimage", "dash-distance", "no-stiffness", "shot-limit"]);
  assert.deepEqual(
    active(core).sort(),
    [
      "30141A43 0002",
      "30141A4F 000F+30141A2E 0000+30141A7D 00FF+30141A34 0001+30141A2D 0000+30141A3A 0000+30141A40 0000",
    ].sort(),
  );

  // unticking a recommended extra means the preset is no longer fully applied; one click restores it
  api.patches.setX4Extra("afterimage", false);
  assert.equal(api.patches.falconPresetEnabled(), false);
  api.patches.setFalconPreset(true);
  assert.equal(api.patches.falconPresetEnabled(), true);

  // switching the preset off disables the patches but keeps the player's extras choice
  api.patches.setFalconPreset(false);
  assert.deepEqual(active(core), []);
  assert.deepEqual(plain(api.patches.getSnapshot().x4Extras), ["afterimage", "dash-distance", "no-stiffness", "shot-limit"]);
});

test("the Falcon equip patch writes the saved selection and the live player byte (X5 only)", () => {
  const { api, attach } = runtime({ [GAME_KEY]: "x5" });
  const equip = api.PATCHES.find((patch) => patch.id === "x5-falcon-equip");
  assert.equal(equip.game, "x5");
  assert.equal(api.X5_ARMOR_VALUES.falcon, "0002", "2 = Falcon in the JP アーマー選択 table");
  assert.equal(equip.code, "300D3121 0002+3009B67A 0002");
  assert.equal(api.resolvePatch(equip).readable, equip.code);
  assert.match(equip.caution, /關卡選擇畫面|進入關卡前/, "must tell the player to enable it before the stage loads");

  const { core } = attach();
  api.patches.set("x5-falcon-equip", true);
  assert.deepEqual(active(core), ["300D3121 0002+3009B67A 0002"]);

  const x4 = runtime({ [GAME_KEY]: "x4" });
  x4.api.patches.set("x5-falcon-equip", true);
  assert.deepEqual(plain(x4.api.patches.getSnapshot().enabled), [], "X5 addresses never reach an X4 disc");
});

test("the Gaea equip patch writes selector 3, and Falcon/Gaea are mutually exclusive", () => {
  const { api, attach } = runtime({ [GAME_KEY]: "x5" });
  const gaea = api.PATCHES.find((patch) => patch.id === "x5-gaea-equip");
  assert.equal(gaea.game, "x5");
  assert.equal(api.X5_ARMOR_VALUES.gaea, "0003", "3 = Gaea in the JP アーマー選択 table");
  assert.equal(gaea.code, "300D3121 0003+3009B67A 0003");
  assert.match(gaea.effect, /尖刺即死無效/);
  assert.match(gaea.caution, /沒有空中衝刺/);

  const { core } = attach();
  api.patches.set("x5-falcon-equip", true);
  assert.deepEqual(active(core), ["300D3121 0002+3009B67A 0002"]);
  api.patches.set("x5-gaea-equip", true);
  assert.deepEqual(plain(api.patches.getSnapshot().enabled), ["x5-gaea-equip"], "last armour opened wins");
  assert.deepEqual(active(core), ["300D3121 0003+3009B67A 0003"], "the Falcon write is switched off, not left competing");
  api.patches.set("x5-falcon-equip", true);
  assert.deepEqual(active(core), ["300D3121 0002+3009B67A 0002"]);

  const x4 = runtime({ [GAME_KEY]: "x4" });
  x4.api.patches.set("x5-gaea-equip", true);
  assert.deepEqual(plain(x4.api.patches.getSnapshot().enabled), [], "X5 addresses never reach an X4 disc");
});

test("gaia preset wears Gaea with an instant X-Buster and clears flight patches (X5 only)", () => {
  const x5 = runtime({ [GAME_KEY]: "x5" });
  const { core } = x5.attach();
  x5.api.patches.set("x5-falcon-equip", true);
  x5.api.patches.set("x5-infinite-flight", true);
  x5.api.patches.set("x5-air-limit", true);
  assert.equal(x5.api.patches.gaiaPresetEnabled(), false);
  assert.equal(x5.api.patches.setGaiaPreset(true), true);
  assert.equal(x5.api.patches.gaiaPresetEnabled(), true);
  assert.equal(x5.api.patches.falconPresetEnabled(), false, "the two armour presets cannot both be complete");
  assert.deepEqual(
    active(core).sort(),
    [X5_ALL_ARMORS, "300D3121 0003+3009B67A 0003", "3009B61C 0002"].sort(),
  );
  assert.equal(x5.api.patches.setGaiaPreset(false), true);
  assert.deepEqual(active(core), []);

  const x4 = runtime({ [GAME_KEY]: "x4" });
  assert.equal(x4.api.patches.setGaiaPreset(true), false, "X4 has no native Gaea armour to wear");
  assert.equal(x4.api.patches.gaiaPresetEnabled(), false);
});

test("the armour and the arm type are two separate cheats now", () => {
  const { api } = runtime();
  const armor = api.PATCHES.find((patch) => patch.id === "fourth-armor");
  const buster = api.PATCHES.find((patch) => patch.id === "buster-type");
  assert.equal(api.resolvePatch(armor).code, ARMOR, "the armour cheat is a single line");
  assert.equal(api.resolvePatch(buster, "stock").code, "30141A60 0001");
  assert.equal(api.resolvePatch(buster, "plasma").code, "30141A60 0002");
  assert.equal(armor.code, ARMOR, "resolving must not mutate the base definition");
});

test("enabling the falcon armor sends the X5 pair", () => {
  const { api, attach } = runtime({ [GAME_KEY]: "x5" });
  const { calls, core } = attach();
  api.syncPatches();
  assert.equal(api.getPatchCheats()[0][0], "開局獵鷹裝甲");
  assert.equal(api.getPatchCheats()[0][1], X5_ALL_ARMORS);
  api.patches.set("falcon-armor", true);
  assert.deepEqual(calls[0], { index: 0, enabled: true, code: X5_ALL_ARMORS });
  assert.deepEqual(active(core), [X5_ALL_ARMORS]);
});

test("X4 ids cannot be applied while X5 is selected, and vice versa", () => {
  const x4 = runtime({ [GAME_KEY]: "x4" });
  x4.api.patches.set("falcon-armor", true);
  assert.deepEqual(plain(x4.api.patches.getSnapshot().enabled), []);

  const x5 = runtime({ [GAME_KEY]: "x5" });
  x5.api.patches.set("fourth-armor", true);
  x5.api.patches.set("infinite-hover", true);
  assert.deepEqual(plain(x5.api.patches.getSnapshot().enabled), []);
});

test("switching games switches off the other game's live cheats", () => {
  const { api, attach } = runtime({ "ps1web.patches.on.x4": '["fourth-armor","buster-type","infinite-hover"]' });
  const { emulator, calls, core } = attach();
  api.syncPatches();
  assert.equal(active(core).length, 3);
  calls.splice(0);

  api.patches.setGame("x5");
  const disabled = new Set(calls.filter((call) => !call.enabled).map((call) => call.code));
  assert.equal(disabled.has(ARMOR), true, "the live armour write is switched off");
  assert.equal(disabled.has("30141A60 0002"), true, "the live arm-type write is switched off");
  assert.equal(disabled.has("30141A7D 00FF"), true, "the live assist write is switched off");
  assert.equal(active(core).length, 0, "nothing stays enabled");
  assert.deepEqual(
    emulator.cheats.map((entry) => entry.desc),
    ["開局獵鷹裝甲", "獵鷹外型能力", "蓋亞外型能力", "獵鷹無限飛行", "取消硬直與連射限制", "X5 X 彈瞬間集滿", "X5 特武瞬間集滿", "X5 空中行動不限次數"],
  );
  assert.deepEqual(plain(api.patches.getSnapshot().enabled), []);
});

test("switching back to X4 restores only the X4 preferences", () => {
  const { api, attach, storage } = runtime({
    [enabledKey("x4")]: '["fourth-armor","buster-type"]',
    [SHOT_KEY]: "stock",
    [enabledKey("x5")]: '["falcon-armor"]',
  });
  const { core } = attach();
  api.patches.setGame("x5");
  assert.deepEqual(active(core), [X5_ALL_ARMORS]);
  api.patches.setGame("x4");
  assert.deepEqual(active(core).sort(), [ARMOR, "30141A60 0001"].sort());
  assert.equal(storage.get(GAME_KEY), "x4");
  assert.deepEqual(plain(api.patches.getSnapshot().enabled), ["fourth-armor", "buster-type"]);
});

test("player-added cheat slots survive a game switch", () => {
  const { api, attach } = runtime({ [LEGACY]: '["fourth-armor"]' });
  const userCheat = { desc: "我的密碼", code: "301722BC 0009", checked: true };
  const { emulator, core } = attach(null);
  emulator.cheats = [
    ...plain(api.getPatchCheats()).map(([desc, code]) => ({ desc, code, checked: false, is_permanent: true })),
    userCheat,
  ];
  api.syncPatches();
  api.patches.set("fourth-armor", true);
  assert.equal(emulator.cheats.some((entry) => entry.desc === "我的密碼"), true);
  assert.equal(active(core).includes("301722BC 0009"), true);

  api.patches.setGame("x5");
  assert.equal(emulator.cheats.some((entry) => entry.desc === "我的密碼"), true);
  assert.equal(active(core).includes("301722BC 0009"), true);
});

test("charge-shot selection is queued for X4 and ignored for X5", () => {
  const { api, attach } = runtime({ [GAME_KEY]: "x5", [SHOT_KEY]: "stock" });
  const { core } = attach();
  api.patches.setChargeShot("plasma");
  api.patches.set("falcon-armor", true);
  assert.deepEqual(active(core), [X5_ALL_ARMORS]);
  assert.equal(api.getPatchCheats().some(([, code]) => code.includes("30141A60")), false);
});

test("switching the arm type rewrites only the arm-type slot", () => {
  const { api, attach } = runtime({ "ps1web.patches.on.x4": '["fourth-armor","buster-type"]' });
  const { calls, core, emulator } = attach();
  api.syncPatches();
  calls.splice(0);
  api.patches.setChargeShot("stock");
  // EmulatorJS' menu redraw re-sends every slot, so judge by the resulting state
  assert.deepEqual(core.get(0), { enabled: true, code: ARMOR }, "the armour slot keeps its state");
  assert.deepEqual(core.get(1), { enabled: true, code: "30141A60 0001" }, "only the arm-type code changed");
  assert.equal(emulator.cheats.length, 7);
});

test("repeated switching never appends conflicting variants", () => {
  const { api, attach } = runtime({ "ps1web.patches.on.x4": '["fourth-armor","buster-type"]' });
  const { core, emulator } = attach();
  api.syncPatches();
  for (let i = 0; i < 30; i++) {
    const shot = i % 2 ? "plasma" : "stock";
    api.patches.setChargeShot(shot);
    const live = active(core).sort();
    assert.deepEqual(live, [ARMOR, `30141A60 ${shot === "plasma" ? "0002" : "0001"}`].sort(), "exactly one arm type is live");
    assert.equal(emulator.cheats.length, 7, "no new slots appear");
  }
});

test("legacy armour entries and stale variants cannot stay active together", () => {
  const { api, attach } = runtime({ [LEGACY]: '["fourth-armor"]', [SHOT_KEY]: "stock" });
  const entries = [
    { desc: "Legacy: armour + stock", code: STOCK, checked: true },
    { desc: "開局第四裝甲", code: ARMOR, checked: false },
    { desc: "Legacy plasma", code: PLASMA, checked: true },
    { desc: "開局獵鷹裝甲", code: X5_ALL_ARMORS, checked: true },
  ];
  const { emulator, calls, core } = attach(entries);
  api.patches.set("fourth-armor", true);
  api.patches.set("buster-type", true);
  assert.equal(emulator.cheats[0].code, ARMOR, "the canonical slot is the first match, rewritten to one line");
  assert.equal(emulator.cheats[0].checked, true);
  assert.equal(emulator.cheats[1].checked, false, "same patch, folded into the first slot");
  assert.equal(emulator.cheats[2].checked, false, "old two-line variant, switched off");
  assert.equal(emulator.cheats.filter((entry) => entry.desc === "開局獵鷹裝甲").length, 0);
  assert.equal(calls.some((call) => call.code === X5_ALL_ARMORS && call.enabled), false);
});

test("the native cheat-menu handlers are refreshed with the selected code", () => {
  const { api, attach } = runtime({ "ps1web.patches.on.x4": '["fourth-armor","buster-type"]' });
  const { core, menu } = attach(undefined);
  api.syncPatches();
  api.patches.setChargeShot("stock");
  assert.deepEqual(menu[0], { checked: true, code: ARMOR });
  assert.deepEqual(menu[1], { checked: true, code: "30141A60 0001" }, "the arm-type slot carries the new code");
  assert.deepEqual(core.get(1), { enabled: true, code: "30141A60 0001" });
});

test("selection and enabled armour survive a fresh module load", () => {
  const first = runtime();
  enableArmour(first, "stock");
  const next = runtime(Object.fromEntries(first.storage));
  const { core } = next.attach();
  next.api.syncPatches();
  assert.deepEqual(core.get(0), { enabled: true, code: ARMOR });
  assert.deepEqual(core.get(1), { enabled: true, code: "30141A60 0001" });
});

test("the detected game overrides a stored choice and is reported", () => {
  const { api, attach } = runtime({ [GAME_KEY]: "x5" });
  const { core } = attach();
  api.setDetectedGame("x4");
  const snapshot = api.patches.getSnapshot();
  assert.equal(snapshot.detected, "x4");
  assert.equal(snapshot.game, "x4");
  assert.deepEqual(active(core), []);
  api.patches.set("fourth-armor", true);
  api.patches.set("buster-type", true);
  assert.deepEqual(active(core).sort(), [ARMOR, "30141A60 0002"].sort());
});

test("an unrecognised file name keeps the current game but is still reported", () => {
  const { api } = runtime({ [GAME_KEY]: "x5" });
  api.setDetectedGame(null);
  const snapshot = api.patches.getSnapshot();
  assert.equal(snapshot.detected, null);
  assert.equal(snapshot.game, "x5");
  assert.deepEqual(
    plain(api.patchesFor(snapshot.game).map((patch) => patch.id)),
    ["falcon-armor", "x5-falcon-equip", "x5-gaea-equip", "x5-infinite-flight", "x5-no-limit", "x5-charge-shot", "x5-charge-special", "x5-air-limit"],
  );
});

test("a detected mismatch is surfaced for the UI to warn about", () => {
  const { api } = runtime({ [GAME_KEY]: "x4" });
  api.setDetectedGame("x5");
  const snapshot = api.patches.getSnapshot();
  assert.equal(snapshot.detected, "x5");
  assert.equal(snapshot.game, "x5");
  api.patches.setGame("x4");
  const switched = api.patches.getSnapshot();
  assert.equal(switched.game, "x4");
  assert.equal(switched.detected, "x5", "the detection is kept so the warning stays visible");
});

test("invalid stored values and duplicate ids are sanitized", () => {
  const { api } = runtime({
    [GAME_KEY]: "x6",
    [SHOT_KEY]: "unknown",
    [LEGACY]: '["fourth-armor","fourth-armor","bad",123]',
  });
  const snapshot = api.patches.getSnapshot();
  assert.equal(snapshot.game, "x4");
  assert.equal(snapshot.chargeShot, "plasma");
  assert.deepEqual(plain(snapshot.enabled), ["fourth-armor"]);
  api.patches.setChargeShot("bad");
  api.patches.set("bad", true);
  api.patches.setGame("x6");
  assert.equal(api.getPatchCheats()[0][1], ARMOR);
  assert.equal(api.getPatchCheats()[1][1], "30141A60 0002", "plasma after an unknown stored value");
  assert.equal(api.patches.getSnapshot().game, "x4");
});

test("controls still work when localStorage is unavailable", () => {
  const { api, attach } = runtime({}, { storageBlocked: true });
  const { core } = attach();
  api.patches.setChargeShot("stock");
  api.patches.set("fourth-armor", true);
  api.patches.set("buster-type", true);
  assert.deepEqual(core.get(1), { enabled: true, code: "30141A60 0001" });
  api.patches.setGame("x5");
  assert.deepEqual(active(core), []);
  api.patches.set("falcon-armor", true);
  assert.deepEqual(active(core), [X5_ALL_ARMORS]);
});

test("a failed core call is not reported as applied and can be retried", () => {
  const { api, attach } = runtime();
  const { emulator, core } = attach();
  const original = emulator.gameManager.setCheat;
  emulator.gameManager.setCheat = () => { throw new Error("Core not ready"); };
  api.patches.set("fourth-armor", true);
  assert.equal(api.patches.getSnapshot().applied, false);
  emulator.gameManager.setCheat = original;
  assert.equal(api.syncPatches(), true);
  assert.deepEqual(core.get(0), { enabled: true, code: ARMOR });
});

test("redundant updates keep a stable external-store snapshot", () => {
  const { api } = runtime();
  let updates = 0;
  const unsubscribe = api.patches.subscribe(() => updates++);
  const before = api.patches.getSnapshot();
  api.patches.setChargeShot("plasma");
  api.patches.set("bad", true);
  api.patches.setGame("x4");
  assert.equal(api.patches.getSnapshot(), before);
  assert.equal(updates, 0);
  api.patches.setChargeShot("stock");
  assert.equal(updates, 1);
  unsubscribe();
  api.patches.setChargeShot("plasma");
  assert.equal(updates, 1);
});

test("instant-charge patches: □ is …43 and △ is …44, exactly as the source annotates", () => {
  const { api } = runtime();
  const byId = Object.fromEntries(api.patchesFor("x4").map((patch) => [patch.id, patch]));
  assert.equal(byId["charge-shot"].code, "30141A43 0002", "口鍵 (□) 的集氣等級");
  assert.equal(byId["charge-special"].code, "30141A44 0002", "三角鍵 (△) 的集氣等級");
  assert.match(byId["charge-shot"].title, /X 彈/, "…43 is the X-Buster, not the special weapon");
  assert.match(byId["charge-special"].title, /特武/, "…44 is the special weapon");
  assert.deepEqual(plain(api.INSTANT_CHARGE_PATCH_IDS), ["charge-shot", "charge-special"]);
  assert.equal(api.patchesFor("x5").some((patch) => api.INSTANT_CHARGE_PATCH_IDS.includes(patch.id)), false);
});

test("setInstantCharge switches both □ and △ on together and reports whether it reached the core", () => {
  const { api, attach, storage } = runtime();
  const { calls, core } = attach();
  assert.equal(api.patches.instantChargeEnabled(), false);
  // EmulatorJS re-applies every slot whenever it redraws its cheat menu, so the
  // call log also contains the switched-off ones; look at the first two writes
  // and at the resulting state instead.
  assert.equal(api.patches.setInstantCharge(true), true);
  assert.deepEqual(plain(calls.slice(0, 2)), [
    { index: 4, enabled: true, code: "30141A43 0002" },
    { index: 5, enabled: true, code: "30141A44 0002" },
  ]);
  assert.deepEqual(
    [...core.values()].filter((slot) => slot.enabled).map((slot) => slot.code).sort(),
    ["30141A43 0002", "30141A44 0002"],
    "exactly these two are live",
  );
  assert.equal(api.patches.instantChargeEnabled(), true);
  assert.equal(JSON.parse(storage.get("ps1web.patches.on.x4")).length, 2);

  calls.splice(0);
  assert.equal(api.patches.setInstantCharge(true), true);
  assert.deepEqual(plain(calls), [], "idempotent: nothing is re-sent");

  assert.equal(api.patches.setInstantCharge(false), true);
  assert.deepEqual(plain(calls.slice(0, 2)), [
    { index: 4, enabled: false, code: "30141A43 0002" },
    { index: 5, enabled: false, code: "30141A44 0002" },
  ]);
  assert.equal(api.patches.instantChargeEnabled(), false);
  assert.equal([...core.values()].some((slot) => slot.enabled), false);
});

test("setInstantCharge leaves other enabled patches alone", () => {
  const { api, attach } = runtime({ "ps1web.patches.on.x4": '["fourth-armor","charge-shot"]' });
  const { core } = attach();
  api.syncPatches();
  assert.equal(api.patches.instantChargeEnabled(), false, "only one of the two is on");
  api.patches.setInstantCharge(true);
  assert.deepEqual(plain(api.patches.getSnapshot().enabled), ["fourth-armor", "charge-shot", "charge-special"]);
  assert.equal([...core.values()].filter((slot) => slot.enabled).length, 3);
  api.patches.setInstantCharge(false);
  assert.deepEqual(plain(api.patches.getSnapshot().enabled), ["fourth-armor"], "the armour patch survives");
});

test("setInstantCharge works on X5 (3009B61C/3009B61B) and queues before the emulator exists", () => {
  const x5 = runtime({ [GAME_KEY]: "x5" });
  const { core: x5Core } = x5.attach();
  assert.equal(x5.api.patches.setInstantCharge(true), true);
  assert.equal(x5.api.patches.instantChargeEnabled(), true);
  assert.deepEqual(plain(x5.api.patches.getSnapshot().enabled), ["x5-charge-shot", "x5-charge-special"]);
  assert.deepEqual(active(x5Core).sort(), ["3009B61B 0002", "3009B61C 0002"]);

  const early = runtime();
  assert.equal(early.api.patches.setInstantCharge(true), false, "queued but not applied yet");
  assert.equal(early.api.patches.instantChargeEnabled(), true, "the intent is remembered");
  const { core } = early.attach();
  early.api.syncPatches();
  assert.deepEqual(
    [...core.values()].filter((slot) => slot.enabled).map((slot) => slot.code).sort(),
    ["30141A43 0002", "30141A44 0002"],
  );
});

test("the instant-charge choice survives a reload and is tracked separately per game", () => {
  const first = runtime();
  first.api.patches.setInstantCharge(true);
  const next = runtime(Object.fromEntries(first.storage));
  assert.equal(next.api.patches.instantChargeEnabled(), true);
  next.api.patches.setGame("x5");
  assert.equal(next.api.patches.instantChargeEnabled(), false, "X5 has its own instant-charge toggles");
  next.api.patches.setGame("x4");
  assert.equal(next.api.patches.instantChargeEnabled(), true, "restored with the X4 list");
});

test("falcon preset enables X5 flight + rapid needle shot without x5-air-limit, and X4 cross-gen flight", () => {
  const x5 = runtime({ [GAME_KEY]: "x5" });
  const { core: x5Core } = x5.attach();
  x5.api.patches.set("x5-air-limit", true);
  assert.equal(x5.api.patches.falconPresetEnabled(), false);
  assert.equal(x5.api.patches.setFalconPreset(true), true);
  assert.equal(x5.api.patches.falconPresetEnabled(), true);
  assert.equal(x5.api.patches.isEnabled("x5-air-limit"), false, "x5-air-limit must be cleared so Falcon flight works");
  assert.deepEqual(
    active(x5Core).sort(),
    [
      X5_ALL_ARMORS,
      "300D3121 0002+3009B67A 0002",
      "3009B612 0000+3009B618 0000",
      "3009B61C 0002",
      "3009B668 00FF",
    ].sort(),
    "the preset wears the Falcon armour, not just unlocks it",
  );
  assert.equal(x5.api.patches.setFalconPreset(false), true);
  assert.deepEqual(active(x5Core), []);

  const x4 = runtime({ [GAME_KEY]: "x4" });
  const { core: x4Core } = x4.attach();
  assert.equal(x4.api.patches.setFalconPreset(true), true);
  assert.equal(x4.api.patches.falconPresetEnabled(), true);
  assert.deepEqual(
    active(x4Core).sort(),
    [
      "30141A43 0002",
      // base flight writes + the recommended 額外寫入 (air-speed deliberately not included)
      "30141A4F 000F+30141A2E 0000+30141A7D 00FF+30141A34 0001+30141A2D 0000+30141A3A 0000+30141A40 0000",
    ],
  );
});

test("X4 獵鷹真外型: the look is a file-table write, other looks restore it, and it stays one slot", () => {
  const BASE = "30141A4F 000F+30141A2E 0000+30141A7D 00FF";
  // { LBA 234195, size 808960 } = the Falcon copy; { LBA 1149, size 780288 } = the original PL00.ARC
  const LOOK = "300F1338 00D3+300F1339 0092+300F133A 0003+300F133B 0000+300F133C 0000+300F133D 0058+300F133E 000C+300F133F 0000";
  const ORIGINAL = "300F1338 007D+300F1339 0004+300F133A 0000+300F133B 0000+300F133C 0000+300F133D 00E8+300F133E 000B+300F133F 0000";
  const { api, attach, storage } = runtime({ "ps1web.patches.on.x4": '["falcon-armor-x4"]' });
  const falcon = api.PATCHES.find((patch) => patch.id === "falcon-armor-x4");
  assert.equal(api.X4_FALCON_LOOK_CODE, LOOK);
  assert.equal(api.X4_ORIGINAL_LOOK_CODE, ORIGINAL);
  assert.deepEqual(plain(api.X4_OUTFITS.map((option) => option.id)), ["fourth", "ultimate", "falcon"]);
  assert.equal(api.resolvePatch(falcon).code, BASE, "nothing changes until the Falcon look is used");
  assert.equal(api.resolvePatch(falcon, "plasma", "falcon", [], false).code, `${BASE}+${LOOK}`);

  const { core, emulator } = attach();
  api.syncPatches();
  const slot = emulator.cheats.findIndex((entry) => entry.appPatchId === "falcon-armor-x4");
  assert.deepEqual(core.get(slot), { enabled: true, code: BASE });

  api.patches.setX4Outfit("falcon");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+${LOOK}` });
  assert.equal(storage.get("ps1web.patches.x4Outfit"), "falcon");

  api.patches.setX4Outfit("fourth");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+${ORIGINAL}` }, "switching back puts the original file back");
  api.patches.setX4Outfit("ultimate");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+301722AF 000F+${ORIGINAL}` });
  api.patches.setX4Extra("afterimage", true);
  api.patches.setX4Outfit("falcon");
  assert.deepEqual(core.get(slot), { enabled: true, code: `${BASE}+${LOOK}+30141A34 0001` }, "extras still append last");
  assert.equal(emulator.cheats.length, 7, "no new slots appear");
  assert.equal([...core.values()].filter((entry) => entry.enabled).length, 1, "no stale variant stays live");

  // a reload keeps the choice, and an old Falcon-look entry is recognised as ours
  const next = runtime({ ...Object.fromEntries(storage), "ps1web.patches.x4Outfit": "falcon" });
  const reattached = next.attach([{ desc: "舊的", code: `${BASE}+${LOOK}`, checked: true }]);
  next.api.syncPatches();
  assert.equal(reattached.emulator.cheats[0].appPatchId, "falcon-armor-x4");
  assert.equal(reattached.emulator.cheats.filter((entry) => entry.appPatchId === "falcon-armor-x4").length, 1);
});
