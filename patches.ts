// Memory patches (GameShark style) for the PlayStation Japanese releases of
// Rockman X4 and Rockman X5.
//
// X4 armor/assists: PTT Rockman board, "[綜合] PS洛克人X4-6特別暴力的金手指".
// X4 arm types (1 = Stock Charge, 2 = Plasma Charge):
//   5ch gameurawaza thread 1286643025 >>93, and wikiwiki.jp/ps006 (ロックマンX4).
// X5 all-armors pair: Bahamut creation 4924841 (SLPM-86666) and injoon84's
//   GameShark list on romhacking.net — 300D3122 001F + 300D3179 00FF.
// X5 armour select (appearance + abilities): JP PAR list "アーマー選択" —
//   3009B67A 000X (live player struct) + 300D3121 000X (saved selection);
//   0 none, 1 Force/Fourth, 2 Falcon, 3 Gaea, 4 Ultimate. The NTSC-U list has
//   the same selector at 300D1C49, which corroborates the meaning of the values.
// X5 flight/shot assists: Bahamut creation 4924841 — 3009B668 00FF (flight),
//   3009B612/3009B618 (stiffness, shot count), 3009B61C/3009B61B (charge).
//
// `30aaaaaa 00vv` writes byte `vv` to address `aaaaaa`; lines join with "+".
// Addresses differ between games, so a patch is only offered for its own game.

export type GameId = "x4" | "x5";
export type ChargeShotType = "stock" | "plasma";

export const GAMES: { id: GameId; label: string; serial: string }[] = [
  { id: "x4", label: "洛克人X4", serial: "SLPS-00902" },
  { id: "x5", label: "洛克人X5", serial: "SLPM-86666" },
];

/** Best-effort guess from the file name the player picked. */
export function detectGame(name: string): GameId | null {
  const compact = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return null;
  if (compact.includes("X5")) return "x5";
  if (compact.includes("X4")) return "x4";
  return null;
}

export type Patch = {
  game: GameId;
  id: string;
  title: string;
  effect: string;
  caution?: string;
  code: string;
  readable?: string;
};

export const FOURTH_ARMOR_ADDR = "30141A4F";
export const BUSTER_TYPE_ADDR = "30141A60";
/** X5 armour selector: saved selection (read when a stage loads) and live player byte. */
export const X5_ARMOR_SELECT_SAVED = "300D3121";
export const X5_ARMOR_SELECT_LIVE = "3009B67A";
/** Values of the X5 armour selector, for reference and tests. */
export const X5_ARMOR_VALUES = { none: "0000", fourth: "0001", falcon: "0002", gaea: "0003", ultimate: "0004" } as const;

export const CHARGE_SHOTS: {
  id: ChargeShotType;
  label: string;
  description: string;
  value: string;
}[] = [
  { id: "stock", label: "四連裝集氣彈", description: "最多儲存 4 發集氣彈，逐發射出。", value: "0001" },
  { id: "plasma", label: "電漿集氣彈", description: "大型集氣彈，命中後留下電漿球。", value: "0002" },
];

/** The only patch whose code depends on another setting. */
const CHARGE_SHOT_PATCH_ID = "buster-type";

/* ---- X4 cross-generation Falcon: look options -------------------------- */

export type X4Outfit = "fourth" | "ultimate" | "falcon";
export const X4_FALCON_PATCH_ID = "falcon-armor-x4";
/** Full armour + unlimited air actions + endless hover = Falcon's free flight on X4. */
export const X4_FALCON_BASE = `${FOURTH_ARMOR_ADDR} 000F+30141A2E 0000+30141A7D 00FF`;
/**
 * X4 hidden-element flag (隠し要素のフラグ): the same flag the character-select
 * secret command raises. With the armour parts already on, X appears in the
 * Ultimate armour (purple/black) with plasma shot and unlimited Nova Strike.
 * Source: 5ch gameurawaza 1286643025 >>93 (0001) and wikiwiki.jp/ps006 (000F).
 */
export const X4_HIDDEN_FLAG_ADDR = "301722AF";
export const X4_HIDDEN_FLAG_CODE = `${X4_HIDDEN_FLAG_ADDR} 000F`;

/**
 * 真・獵鷹外型 (X5 sprites on X4). The "X4 獵鷹映像" built by the disc tool keeps the original
 * PL00.ARC (LBA 1149) and adds a Falcon copy (LBA 234195). X4 reads that file through a table in
 * the executable — { LBA, size } at RAM 0x800F1338 — so rewriting those 8 bytes before a stage
 * loads picks which copy the game reads. Written as 8-bit writes like every other X4 code here.
 */
const X4_FILE_TABLE_ADDR = 0x0f1338;
function x4LookCode(lba: number, size: number): string {
  const bytes = [lba, lba >>> 8, lba >>> 16, lba >>> 24, size, size >>> 8, size >>> 16, size >>> 24];
  return bytes
    .map((byte, index) => {
      const address = (X4_FILE_TABLE_ADDR + index).toString(16).toUpperCase().padStart(6, "0");
      return `30${address} 00${(byte & 255).toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("+");
}
export const X4_FALCON_LOOK_CODE = x4LookCode(234195, 808960);
export const X4_ORIGINAL_LOOK_CODE = x4LookCode(1149, 780288);

export const X4_OUTFITS: { id: X4Outfit; label: string; description: string; extra: string | null; hidden?: boolean }[] = [
  {
    id: "fourth",
    hidden: true,
    label: "第四裝甲",
    description: "白藍配色，X4 裡最接近獵鷹裝甲的外型；彈種跟著「集氣彈種類」。",
    extra: null,
  },
  {
    id: "ultimate",
    hidden: true,
    label: "究極裝甲",
    description: "紫黑配色的隱藏裝甲：固定電漿彈、NOVA STRIKE 不限次數。立起隱藏旗標，等同輸入隱藏指令。",
    extra: X4_HIDDEN_FLAG_CODE,
  },
  {
    id: "falcon",
    label: "獵鷹裝甲（真外型）",
    description:
      "X5 的獵鷹外型（頭冠與整套圖像）。需要用「X4 獵鷹映像」製作工具做出的光碟；在進入關卡前選好，下一次載入關卡時生效。選回其他外型會自動還原。",
    extra: X4_FALCON_LOOK_CODE,
  },
];

/**
 * 額外寫入: optional extra X4 writes appended to the cross-generation Falcon
 * patch, each mapped to a trait of X5's Falcon armour. All from the same X4
 * list as the base code (PTT Rockman, x753951, 2015-09-13).
 *
 * The five writes split into two groups: 「能力」 (what the Falcon armour
 * does) and 「外型」 (what it looks like in motion). Array order is the
 * canonical code order and is intentionally untouched by the grouping.
 */
export type X4ExtraId = "afterimage" | "dash-distance" | "air-speed" | "no-stiffness" | "shot-limit" | "hit-skip" | "hp-lock";
export type X4ExtraGroup = "ability" | "appearance" | "experiment";

export const X4_EXTRA_GROUPS: { id: X4ExtraGroup; label: string; hint: string }[] = [
  { id: "ability", label: "能力", hint: "獵鷹的動作與射擊" },
  { id: "appearance", label: "外型", hint: "獵鷹在移動中的視覺" },
  { id: "experiment", label: "實驗", hint: "診斷用，請一次只開一項" },
];

export const X4_EXTRA_WRITES: {
  id: X4ExtraId;
  group: X4ExtraGroup;
  /** the Falcon trait this write reproduces, shown as a chip in the UI */
  falcon: string;
  label: string;
  description: string;
  code: string;
}[] = [
  {
    id: "afterimage",
    group: "appearance",
    falcon: "飛行殘影軌跡",
    label: "殘影軌跡",
    description: "X 移動時留下殘影，重現獵鷹飛行與 F-Splasher 的軌跡感。",
    code: "30141A34 0001",
  },
  {
    id: "dash-distance",
    group: "ability",
    falcon: "F-Splasher 長距離突進",
    label: "衝刺距離無限",
    description: "空中衝刺不再中途停止，等同把每次空衝都變成 Giga Attack 級的突進。",
    code: "30141A2D 0000",
  },
  {
    id: "air-speed",
    group: "ability",
    falcon: "高速空中移動",
    label: "空中移動衝刺速度",
    description: "空中位移一律採衝刺跳躍的速度，飛行更快；平台跳躍會變得較難掌握。",
    code: "30141A2C 0001",
  },
  {
    id: "no-stiffness",
    group: "ability",
    falcon: "針狀彈連發",
    label: "集氣射擊硬直取消",
    description: "射出集氣彈後不再有無法開火的硬直，可連續射出滿集氣彈。",
    code: "30141A3A 0000",
  },
  {
    id: "shot-limit",
    group: "ability",
    falcon: "針狀彈連發",
    label: "連射限制解除",
    description: "畫面上同時只能有 3 顆子彈／電漿球的限制解除，連發不再被吞彈。",
    code: "30141A40 0000",
  },
  {
    // Experiment. 0x8002DD7C is `bne v0,zero,+0x37` right after the hit handler's immunity check
    // (`lb v0,0x7a(s1)`); rewriting its upper half (0x1440 -> 0x1000) turns it into an unconditional
    // branch, so every hit routed through that handler is skipped. Which side it protects (X, enemies,
    // or both) is what this experiment is meant to tell us.
    id: "hit-skip",
    group: "experiment",
    falcon: "飛行無敵",
    label: "診斷A：受擊處理一律略過（實驗）",
    description:
      "把受擊處理程式改成直接略過傷害。請回報：X 受傷了嗎？敵人受傷了嗎？依結果才知道這段程式管的是哪一邊。",
    code: "8002DD7E 1000",
  },
  {
    // Experiment. If the player's HP is the byte at entity +0x5C (0x80141A5C) this keeps it full.
    id: "hp-lock",
    group: "experiment",
    falcon: "飛行無敵",
    label: "診斷B：鎖定血量（實驗）",
    description: "每一格都把 0x80141A5C 寫成 0x20。請回報：被打到後血條有沒有減少？血條有沒有出現怪異。",
    code: "30141A5C 0020",
  },
];

export const X4_EXTRA_IDS: readonly X4ExtraId[] = X4_EXTRA_WRITES.map((extra) => extra.id);

export function isX4ExtraId(value: unknown): value is X4ExtraId {
  return typeof value === "string" && (X4_EXTRA_IDS as readonly string[]).includes(value);
}

/** Canonical order (the table order) so the same choice always yields the same code. */
export function sortX4Extras(extras: readonly string[]): X4ExtraId[] {
  const wanted = new Set(extras);
  return X4_EXTRA_IDS.filter((id) => wanted.has(id));
}

export function x4FalconCode(outfit: X4Outfit, extras: readonly string[] = [], restoreLook = false): string {
  const parts = [X4_FALCON_BASE];
  const look = X4_OUTFITS.find((option) => option.id === outfit)?.extra ?? null;
  if (look) parts.push(look);
  // once the Falcon look has been written this session, the other looks must put the original file back
  if (restoreLook && outfit !== "falcon") parts.push(X4_ORIGINAL_LOOK_CODE);
  for (const id of sortX4Extras(extras)) {
    const extra = X4_EXTRA_WRITES.find((candidate) => candidate.id === id);
    if (extra) parts.push(extra.code);
  }
  return parts.join("+");
}

export const PATCHES: Patch[] = [
  {
    game: "x4",
    id: "fourth-armor",
    title: "開局第四裝甲",
    effect: "套用 X 的全套第四裝甲：空中衝刺、漂浮、傷害減半與 NOVA STRIKE。手部彈種由「集氣彈種類」決定。",
    caution:
      "請先快速存檔。建議在開始新遊戲前啟用。關閉開關只停止鎖定數值，不會還原遊戲狀態。",
    code: `${FOURTH_ARMOR_ADDR} 000F`,
  },
  {
    game: "x4",
    id: "buster-type",
    title: "集氣彈種類",
    effect: "切換手部零件：四連裝集氣彈或電漿集氣彈。開啟「雙彈種」後，□ 與 △ 各用一種。",
    caution: "屬於第四裝甲的手部零件；需要裝甲才看得到效果。",
    code: `${BUSTER_TYPE_ADDR} 0002`,
  },
  {
    game: "x4",
    id: "air-limit",
    title: "空中行動不限次數",
    effect: "空中衝刺、兩段跳、漂浮、NOVA STRIKE 在空中不再受使用次數限制。",
    code: "30141A2E 0000",
  },
  {
    game: "x4",
    id: "infinite-hover",
    title: "無限漂浮時間",
    effect: "第四裝甲的腳部漂浮不會再自動結束。",
    code: "30141A7D 00FF",
  },
  {
    game: "x4",
    id: "charge-shot",
    title: "X 彈瞬間集滿",
    effect: "□ 的集氣等級直接集滿，不必等待集氣時間，搭配自動集氣可連續射出集氣炮。",
    caution: "配合「自動集氣」效果最好；單獨開啟時射擊後仍有硬直。",
    code: "30141A43 0002",
  },
  {
    game: "x4",
    id: "charge-special",
    title: "特武瞬間集滿",
    effect: "△ 特殊武器的集氣等級直接集滿，讓雙開時 □ 與 △ 都能立刻射出集氣彈。",
    caution: "需要手部裝甲才能集氣特殊武器；集氣特武會消耗武器能源。",
    code: "30141A44 0002",
  },
  {
    game: "x5",
    id: "falcon-armor",
    title: "開局獵鷹裝甲",
    effect:
      "開局即可選用獵鷹裝甲（自由飛行、針狀集氣彈），同時開放第四、蓋亞、究極裝甲與黑傑洛。這是《洛克人X5》的裝甲；X4 那邊的對應選項是「跨代:獵鷹裝甲」。",
    caution:
      "此碼一併開放黑傑洛旗標；獵鷹裝甲無法集氣特殊武器、防禦減半。僅適用 PS 日版《洛克人X5》（SLPM-86666）。",
    code: "300D3122 001F+300D3179 00FF",
  },
  {
    // Appearance AND abilities: the game loads the Falcon sprite set (PL0x.DAT)
    // for the stage from the saved selection byte, and the live player byte
    // selects the move set, so both are written.
    game: "x5",
    id: "x5-falcon-equip",
    title: "獵鷹外型能力",
    effect:
      "直接讓 X 穿上獵鷹裝甲，外型與能力一併生效：自由飛行、針狀貫穿集氣彈與 Giga Attack，不必再到角色選擇畫面切換。",
    caution:
      "請在關卡選擇畫面或進入關卡前開啟；遊戲載入關卡時才會讀入獵鷹裝甲的圖像，關卡中途開啟可能出現圖像錯亂，重新進入關卡即可。開啟期間裝甲鎖定為獵鷹，要換其他裝甲請先關閉。僅適用 PS 日版《洛克人X5》（SLPM-86666）。",
    code: `${X5_ARMOR_SELECT_SAVED} 0002+${X5_ARMOR_SELECT_LIVE} 0002`,
  },
  {
    // Same selector as Falcon, value 3: the game loads the Gaea sprite set and
    // move set (spike immunity, wall cling, Gaea Shot) when the stage loads.
    game: "x5",
    id: "x5-gaea-equip",
    title: "蓋亞外型能力",
    effect:
      "直接讓 X 穿上蓋亞裝甲，外型與能力一併生效：受傷減半、尖刺即死無效、貼牆不下滑、強力短程蓋亞射擊與近距離 Giga Attack，不必再到角色選擇畫面切換。",
    caution:
      "請在關卡選擇畫面或進入關卡前開啟；遊戲載入關卡時才會讀入蓋亞裝甲的圖像，關卡中途開啟可能出現圖像錯亂，重新進入關卡即可。開啟期間裝甲鎖定為蓋亞，要換其他裝甲請先關閉；與「獵鷹外型能力」同時開啟時會自動改穿最後開啟的一種。蓋亞移動較慢、沒有空中衝刺，也不能使用特殊武器與強化零件。僅適用 PS 日版《洛克人X5》（SLPM-86666）。",
    code: `${X5_ARMOR_SELECT_SAVED} ${X5_ARMOR_VALUES.gaea}+${X5_ARMOR_SELECT_LIVE} ${X5_ARMOR_VALUES.gaea}`,
  },
  {
    game: "x5",
    id: "x5-infinite-flight",
    title: "獵鷹無限飛行",
    effect: "獵鷹裝甲在空中自由飛行（或第四裝甲漂浮）不會消耗飛行條、不會自動下墜。",
    caution: "勿與「空中行動不限次數」同時開啟，否則飛行動作會被兩段跳取代。僅適用 PS 日版《洛克人X5》。",
    code: "3009B668 00FF",
  },
  {
    game: "x5",
    id: "x5-no-limit",
    title: "取消硬直與連射限制",
    effect: "解除射擊集氣彈後的硬直時間與畫面上子彈數量上限，讓獵鷹針狀集氣彈能高速連發。",
    code: "3009B612 0000+3009B618 0000",
  },
  {
    game: "x5",
    id: "x5-charge-shot",
    title: "X5 X 彈瞬間集滿",
    effect: "□ 的集氣等級直接集滿，獵鷹裝甲的針狀貫穿彈不必等待集氣時間，搭配自動集氣即可連射。",
    code: "3009B61C 0002",
  },
  {
    game: "x5",
    id: "x5-charge-special",
    title: "X5 特武瞬間集滿",
    effect: "△ 特殊武器的集氣等級直接集滿；獵鷹裝甲無法集氣特殊武器，切換為第四／究極裝甲時有效。",
    code: "3009B61B 0002",
  },
  {
    game: "x5",
    id: "x5-air-limit",
    title: "X5 空中行動不限次數",
    effect: "空中衝刺與兩段跳不受次數限制。",
    caution: "X5 開啟此項會改走兩段跳而使第四／獵鷹裝甲失去原本飛行能力；想用獵鷹飛行請保持關閉、改開「獵鷹無限飛行」。",
    code: "3009B606 0000",
  },
  {
    // Cross-generation: X5's Falcon armor does not exist in X4's data, so the
    // X5 addresses cannot be reused here. Instead the three X4 writes that give
    // Falcon's signature free flight are combined into one switch, and the
    // "outfit" option picks between the two looks X4 actually contains:
    // the Fourth armor, or the Ultimate armor via the hidden-element flag.
    game: "x4",
    id: "falcon-armor-x4",
    title: "跨代:獵鷹外型能力",
    effect:
      "跨代重現《洛克人X5》獵鷹裝甲：開局即有全套裝甲與自由飛行（空中衝刺、兩段跳、漂浮與 NOVA STRIKE 不限次數，漂浮不會自動結束）。外型可選第四裝甲（白藍）、究極裝甲（紫黑，X4 的隱藏裝甲），或用「X4 獵鷹映像」光碟時的獵鷹裝甲（X5 的真外型）。",
    caution:
      "原版 X4 光碟沒有獵鷹裝甲的圖像，外型只能在第四與究極裝甲之間選擇；獵鷹真外型需要「X4 獵鷹映像」光碟，且不會有 X5 的針狀集氣彈。究極外型是立起隱藏旗標，等同輸入隱藏指令，可能會留在存檔裡。請先快速存檔，建議開始新遊戲前啟用。僅適用 PS 日版《洛克人X4》（SLPS-00902）。",
    code: X4_FALCON_BASE,
  },
];

export function patchesFor(game: GameId): Patch[] {
  return PATCHES.filter((patch) => patch.game === game);
}

/** The two "instant full charge" patches (□ and △). Used by the 雙開 shortcut. */
export const INSTANT_CHARGE_PATCH_IDS: readonly string[] = ["charge-shot", "charge-special"];

export const INSTANT_CHARGE_BY_GAME: Record<GameId, readonly string[]> = {
  x4: INSTANT_CHARGE_PATCH_IDS,
  x5: ["x5-charge-shot", "x5-charge-special"],
};

/** 獵鷹裝甲推薦補丁套組（X5 刻意排除會覆蓋飛行的 x5-air-limit）。 */
export const FALCON_PRESET_BY_GAME: Record<
  GameId,
  { on: readonly string[]; off?: readonly string[]; extras?: readonly X4ExtraId[] }
> = {
  x4: {
    on: ["falcon-armor-x4", "charge-shot"],
    // 額外寫入 that read as Falcon without changing how platforming feels;
    // "air-speed" is left to the player
    extras: ["afterimage", "dash-distance", "no-stiffness", "shot-limit"],
  },
  x5: {
    on: ["falcon-armor", "x5-falcon-equip", "x5-infinite-flight", "x5-no-limit", "x5-charge-shot"],
    off: ["x5-air-limit", "x5-gaea-equip"],
  },
};

/** 獵鷹與蓋亞寫的是同一個裝甲選擇位址，不能同時生效；最後開啟的一種為準。 */
export const X5_ARMOR_EQUIP_IDS: readonly string[] = ["x5-falcon-equip", "x5-gaea-equip"];

/** 蓋亞裝甲推薦補丁套組（X5 專用）：穿上蓋亞 + X 彈瞬滿，並關閉飛行系補丁。 */
export const GAIA_PRESET_X5: { on: readonly string[]; off: readonly string[] } = {
  on: ["falcon-armor", "x5-gaea-equip", "x5-charge-shot"],
  off: ["x5-falcon-equip", "x5-infinite-flight", "x5-air-limit"],
};

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * The buster-type patch writes whichever arm part is live right now; the X4
 * cross-generation Falcon patch carries the chosen outfit.
 */
export function resolvePatch(
  patch: Patch,
  shot: ChargeShotType = state.liveShot,
  outfit: X4Outfit = state.x4Outfit,
  extras: readonly string[] = state.x4Extras,
  restoreLook: boolean = state.x4LookSwitched,
): Patch {
  if (patch.id === CHARGE_SHOT_PATCH_ID) {
    return { ...patch, code: `${BUSTER_TYPE_ADDR} ${shotValue(shot)}` };
  }
  if (patch.id === X4_FALCON_PATCH_ID) {
    const code = x4FalconCode(outfit, extras, restoreLook);
    return { ...patch, code, readable: code };
  }
  return patch.readable ? patch : { ...patch, readable: patch.code };
}

function shotValue(shot: ChargeShotType) {
  return CHARGE_SHOTS.find((option) => option.id === shot)?.value ?? CHARGE_SHOTS[1].value;
}

/**
 * Every code a patch can resolve to, so old entries can be recognised later. The
 * armour patch used to carry the buster type on a second line, so those old
 * two-line codes are listed here too and folded back into the armour slot.
 */
function variantsOf(patch: Patch): string[] {
  if (patch.id === CHARGE_SHOT_PATCH_ID) {
    return CHARGE_SHOTS.map((option) => `${BUSTER_TYPE_ADDR} ${option.value}`);
  }
  if (patch.id === "fourth-armor") {
    return CHARGE_SHOTS.map((option) => `${patch.code}+${BUSTER_TYPE_ADDR} ${option.value}`);
  }
  if (patch.id === X4_FALCON_PATCH_ID) {
    // outfit × extras is small (2 × 2^5); listing every combination keeps the
    // "is this slot ours?" check a plain equality like the other patches
    const combos: string[] = [];
    for (const option of X4_OUTFITS) {
      for (const restore of [false, true]) {
        for (let mask = 0; mask < 1 << X4_EXTRA_IDS.length; mask++) {
          combos.push(x4FalconCode(option.id, X4_EXTRA_IDS.filter((_, index) => mask & (1 << index)), restore));
        }
      }
    }
    return combos;
  }
  return [patch.code];
}

export function getPatchCheats(): [string, string][] {
  return patchesFor(state.game).map((patch) => [patch.title, resolvePatch(patch).code]);
}

/* ------------------------------------------------------------------ */
/*  Stored preferences                                                 */
/* ------------------------------------------------------------------ */

const GAME_KEY = "ps1web.patches.game";
const SHOT_KEY = "ps1web.patches.chargeShot";
const MODE_KEY = "ps1web.patches.chargeShotMode";
const SQUARE_KEY = "ps1web.patches.squareShot";
const TRIANGLE_KEY = "ps1web.patches.triangleShot";
const X4_OUTFIT_KEY = "ps1web.patches.x4Outfit";
const X4_EXTRAS_KEY = "ps1web.patches.x4Extras";
const LEGACY_ENABLED_KEY = "ps1web.patches.on";
const enabledKey = (game: GameId) => `ps1web.patches.on.${game}`;

function isGameId(value: unknown): value is GameId {
  return value === "x4" || value === "x5";
}

function isChargeShotType(value: unknown): value is ChargeShotType {
  return value === "stock" || value === "plasma";
}

function isX4Outfit(value: unknown): value is X4Outfit {
  return value === "fourth" || value === "ultimate" || value === "falcon";
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable – the session still works, it just won't persist */
  }
}

function readGame(): GameId {
  const value = readRaw(GAME_KEY);
  return isGameId(value) ? value : "x4";
}

function readShot(): ChargeShotType {
  const value = readRaw(SHOT_KEY);
  return isChargeShotType(value) ? value : "plasma";
}

function readX4Outfit(): X4Outfit {
  const value = readRaw(X4_OUTFIT_KEY);
  return isX4Outfit(value) ? value : "falcon";
}

function readX4Extras(): X4ExtraId[] {
  try {
    const parsed: unknown = JSON.parse(readRaw(X4_EXTRAS_KEY) ?? "[]");
    return Array.isArray(parsed) ? sortX4Extras(parsed.filter(isX4ExtraId)) : [];
  } catch {
    return [];
  }
}

function readEnabled(game: GameId): string[] {
  const raw = readRaw(enabledKey(game)) ?? (game === "x4" ? readRaw(LEGACY_ENABLED_KEY) : null);
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const known = new Set(patchesFor(game).map((patch) => patch.id));
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && known.has(x)))];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

/**
 * 雙彈種: each attack button gets its own arm part. □ is the X-Buster, △ the
 * special weapon, so the game's single "arm type" byte is flipped to match
 * whichever button is about to fire.
 */
export type ChargeShotMode = "single" | "perButton";
export const PER_BUTTON_DEFAULT: Record<"square" | "triangle", ChargeShotType> = {
  square: "stock",
  triangle: "plasma",
};

export interface PatchState {
  game: GameId;
  /** what the loaded file name looked like, if it could be recognised */
  detected: GameId | null;
  enabled: string[];
  chargeShot: ChargeShotType;
  chargeShotMode: ChargeShotMode;
  /** in perButton mode: which arm part each button uses */
  squareShot: ChargeShotType;
  triangleShot: ChargeShotType;
  /** the arm part currently written to memory (differs from chargeShot while a per-button shot is in flight) */
  liveShot: ChargeShotType;
  /** which of X4's two looks the cross-generation Falcon patch wears */
  x4Outfit: X4Outfit;
  /** the Falcon look was written to memory this session, so other looks must restore the original file */
  x4LookSwitched: boolean;
  /** 額外寫入 appended to the cross-generation Falcon patch, in table order */
  x4Extras: X4ExtraId[];
  applied: boolean;
}

function readMode(): ChargeShotMode {
  return readRaw(MODE_KEY) === "perButton" ? "perButton" : "single";
}

/** Reads one half of the per-button assignment; falls back to the documented default. */
function readPerButton(key: string, fallback: ChargeShotType): ChargeShotType {
  const value = readRaw(key);
  return isChargeShotType(value) ? value : fallback;
}

let state: PatchState = {
  game: readGame(),
  detected: null,
  enabled: readEnabled(readGame()),
  chargeShot: readShot(),
  chargeShotMode: readMode(),
  squareShot: readPerButton(SQUARE_KEY, PER_BUTTON_DEFAULT.square),
  triangleShot: readPerButton(TRIANGLE_KEY, PER_BUTTON_DEFAULT.triangle),
  liveShot: readShot(),
  x4Outfit: readX4Outfit(),
  x4LookSwitched: readX4Outfit() === "falcon",
  x4Extras: readX4Extras(),
  applied: false,
};
const listeners = new Set<() => void>();

function publish(change: Partial<PatchState>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/*  EmulatorJS bridge                                                 */
/* ------------------------------------------------------------------ */

type CheatEntry = {
  desc: string;
  code: string;
  checked?: boolean;
  is_permanent?: boolean;
  appPatchId?: string;
};

type CheatManager = {
  cheats?: CheatEntry[];
  cheatChanged?: (checked: boolean, code: string, index: number) => void;
  gameManager?: { setCheat?: (index: number, enabled: boolean, code: string) => void };
  updateCheatUI?: () => void;
};

const normalizeCode = (code: string) => code.replace(/\s/g, "").toUpperCase();

/** Which of our patches an emulator cheat slot belongs to, if any. */
function ownerOf(entry: CheatEntry): Patch | undefined {
  if (entry.appPatchId) {
    const byId = PATCHES.find((patch) => patch.id === entry.appPatchId);
    if (byId) return byId;
  }
  const byTitle = PATCHES.find((patch) => patch.title === entry.desc);
  if (byTitle) return byTitle;
  const code = normalizeCode(entry.code);
  return PATCHES.find((patch) => variantsOf(patch).some((variant) => normalizeCode(variant) === code));
}

/**
 * Registers the current game's patches with EmulatorJS and applies the switched-on
 * ones. Entries belonging to the other game are switched off and removed first, so
 * X4 addresses can never stay live while an X5 disc is running. Cheat slots the
 * player added themselves are left alone.
 */
export function syncPatches(): boolean {
  const ejs = window.EJS_emulator as CheatManager | undefined;
  const list = ejs?.cheats;
  if (!ejs?.gameManager?.setCheat || !list || !ejs.cheatChanged) return false;
  let changed = false;

  try {
    for (let i = list.length - 1; i >= 0; i--) {
      const owner = ownerOf(list[i]);
      if (!owner || owner.game === state.game) continue;
      if (list[i].checked) ejs.cheatChanged(false, list[i].code, i);
      list.splice(i, 1);
      changed = true;
    }

    for (const patch of patchesFor(state.game)) {
      const resolved = resolvePatch(patch);
      const matches = list.flatMap((entry, index) => (ownerOf(entry) === patch ? [index] : []));
      let index = matches[0];
      if (index === undefined) {
        index = list.length;
        list.push({ desc: patch.title, code: resolved.code, checked: false, is_permanent: true });
        changed = true;
      }

      // An older build wrote the buster type as a second line of the armour cheat, so
      // a stored preference can still hold one of those. Switch it off, but never
      // splice it out: EmulatorJS maps cheat slots to the core by list index, so
      // removing an entry would silently shift every cheat after it.
      for (const duplicate of matches.slice(1)) {
        if (list[duplicate].checked) {
          ejs.cheatChanged(false, list[duplicate].code, duplicate);
          list[duplicate].checked = false;
          changed = true;
        }
      }

      const entry = list[index];
      const on = state.enabled.includes(patch.id);
      const codeChanged = entry.code !== resolved.code;
      if (entry.checked && codeChanged) {
        ejs.cheatChanged(false, entry.code, index);
        entry.checked = false;
        changed = true;
      }
      entry.appPatchId = patch.id;
      entry.is_permanent = true;
      entry.desc = patch.title;
      entry.code = resolved.code;
      changed = changed || codeChanged;

      if (Boolean(entry.checked) !== on) {
        ejs.cheatChanged(on, entry.code, index);
        entry.checked = on;
        changed = true;
      }
    }

    // The built-in menu captures codes in its click handlers; refresh those too.
    if (changed) ejs.updateCheatUI?.();
    if (!state.applied) publish({ applied: true });
    return true;
  } catch {
    if (state.applied) publish({ applied: false });
    return false;
  }
}

export const patches = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => state,
  isEnabled: (id: string) => state.enabled.includes(id),
  set(id: string, on: boolean) {
    if (!patchesFor(state.game).some((patch) => patch.id === id)) return;
    // Falcon and Gaea write the same armour-selector addresses: last one wins.
    const rivals = on ? X5_ARMOR_EQUIP_IDS.filter((x) => x !== id) : [];
    const base = on ? state.enabled.filter((x) => !rivals.includes(x)) : state.enabled;
    const enabled = on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    if (sameIds(enabled, state.enabled)) return;
    writeStored(enabledKey(state.game), JSON.stringify(enabled));
    publish({ enabled, applied: false });
    syncPatches();
  },
  setChargeShot(shot: ChargeShotType) {
    if (!isChargeShotType(shot) || shot === state.chargeShot) return;
    writeStored(SHOT_KEY, shot);
    publish({ chargeShot: shot, liveShot: shot, applied: false });
    syncPatches();
  },
  /** X4 跨代獵鷹的外型：第四裝甲或究極裝甲（隱藏旗標）。 */
  setX4Outfit(outfit: X4Outfit) {
    if (!isX4Outfit(outfit) || outfit === state.x4Outfit) return;
    writeStored(X4_OUTFIT_KEY, outfit);
    publish({ x4Outfit: outfit, x4LookSwitched: state.x4LookSwitched || outfit === "falcon", applied: false });
    syncPatches();
  },
  /** 額外寫入：開關一個附加在跨代獵鷹補丁上的 X4 位址。 */
  setX4Extra(id: X4ExtraId, on: boolean) {
    if (!isX4ExtraId(id)) return;
    if (on === state.x4Extras.includes(id)) return;
    const next = sortX4Extras(on ? [...state.x4Extras, id] : state.x4Extras.filter((x) => x !== id));
    writeStored(X4_EXTRAS_KEY, JSON.stringify(next));
    publish({ x4Extras: next, applied: false });
    syncPatches();
  },
  /** 批量設定（UI 的「能力／外型」全選與全不選用）：一次正規化、一次送達模擬器。 */
  setX4Extras(ids: readonly X4ExtraId[]) {
    const next = sortX4Extras(ids.filter(isX4ExtraId));
    if (sameIds(next, state.x4Extras)) return;
    writeStored(X4_EXTRAS_KEY, JSON.stringify(next));
    publish({ x4Extras: next, applied: false });
    syncPatches();
  },
  x4ExtraEnabled(id: X4ExtraId): boolean {
    return state.x4Extras.includes(id);
  },
  setChargeShotMode(mode: ChargeShotMode) {
    if (mode !== "single" && mode !== "perButton") return;
    if (mode === state.chargeShotMode) return;
    writeStored(MODE_KEY, mode);
    publish({ chargeShotMode: mode, liveShot: state.chargeShot, applied: false });
    syncPatches();
  },
  /** Which arm part a button uses in perButton mode. */
  setButtonShot(button: "square" | "triangle", shot: ChargeShotType) {
    if (button !== "square" && button !== "triangle") return;
    if (!isChargeShotType(shot)) return;
    const current = button === "square" ? state.squareShot : state.triangleShot;
    if (shot === current) return;
    writeStored(button === "square" ? SQUARE_KEY : TRIANGLE_KEY, shot);
    publish(button === "square" ? { squareShot: shot } : { triangleShot: shot });
  },
  /** The arm part a given attack button fires with, in the current mode. */
  shotForButton(button: "square" | "triangle"): ChargeShotType {
    // perButton is an X4 idea; on any other game every button uses the single choice
    if (state.chargeShotMode !== "perButton" || state.game !== "x4") return state.chargeShot;
    return button === "square" ? state.squareShot : state.triangleShot;
  },
  /**
   * 便利開關：一次開啟或關閉「□ 與 △ 瞬間集滿」（X4 與 X5 皆支援）。
   * 模擬器尚未就緒時回傳 false，呼叫端可據此提示。
   */
  setInstantCharge(on: boolean): boolean {
    const ids = INSTANT_CHARGE_BY_GAME[state.game].filter((id) =>
      patchesFor(state.game).some((patch) => patch.id === id),
    );
    if (!ids.length) return false;
    const enabled = on ? [...new Set([...state.enabled, ...ids])] : state.enabled.filter((x) => !ids.includes(x));
    if (sameIds(enabled, state.enabled)) return syncPatches();
    writeStored(enabledKey(state.game), JSON.stringify(enabled));
    publish({ enabled, applied: false });
    return syncPatches();
  },
  instantChargeEnabled(): boolean {
    const ids = INSTANT_CHARGE_BY_GAME[state.game];
    return ids.length > 0 && ids.every((id) => state.enabled.includes(id));
  },
  /** 一鍵套用或解除當前片別的獵鷹補丁推薦組合（X4 連同建議的額外寫入）。 */
  setFalconPreset(on: boolean): boolean {
    const preset = FALCON_PRESET_BY_GAME[state.game];
    const offSet = new Set(preset.off ?? []);
    const enabled = on
      ? [...new Set([...state.enabled.filter((x) => !offSet.has(x)), ...preset.on])]
      : state.enabled.filter((x) => !preset.on.includes(x));
    const change: Partial<PatchState> = {};
    if (!sameIds(enabled, state.enabled)) {
      writeStored(enabledKey(state.game), JSON.stringify(enabled));
      change.enabled = enabled;
    }
    if (on && preset.extras?.length) {
      const extras = sortX4Extras([...state.x4Extras, ...preset.extras]);
      if (!sameIds(extras, state.x4Extras)) {
        writeStored(X4_EXTRAS_KEY, JSON.stringify(extras));
        change.x4Extras = extras;
      }
    }
    if (!Object.keys(change).length) return syncPatches();
    publish({ ...change, applied: false });
    return syncPatches();
  },
  falconPresetEnabled(): boolean {
    const preset = FALCON_PRESET_BY_GAME[state.game];
    const offSet = new Set(preset.off ?? []);
    return (
      preset.on.every((id) => state.enabled.includes(id)) &&
      !state.enabled.some((id) => offSet.has(id)) &&
      (preset.extras ?? []).every((id) => state.x4Extras.includes(id))
    );
  },
  /** 一鍵套用或解除 X5 的蓋亞重裝組合；X4 沒有對應的原生蓋亞裝甲，因此不動作。 */
  setGaiaPreset(on: boolean): boolean {
    if (state.game !== "x5") return false;
    const offSet = new Set(GAIA_PRESET_X5.off);
    const enabled = on
      ? [...new Set([...state.enabled.filter((x) => !offSet.has(x)), ...GAIA_PRESET_X5.on])]
      : state.enabled.filter((x) => !GAIA_PRESET_X5.on.includes(x));
    if (sameIds(enabled, state.enabled)) return syncPatches();
    writeStored(enabledKey(state.game), JSON.stringify(enabled));
    publish({ enabled, applied: false });
    return syncPatches();
  },
  gaiaPresetEnabled(): boolean {
    if (state.game !== "x5") return false;
    const offSet = new Set(GAIA_PRESET_X5.off);
    return (
      GAIA_PRESET_X5.on.every((id) => state.enabled.includes(id)) &&
      !state.enabled.some((id) => offSet.has(id))
    );
  },
  setGame(game: GameId) {
    if (!isGameId(game) || game === state.game) {
      syncPatches();
      return;
    }
    writeStored(GAME_KEY, game);
    publish({ game, enabled: readEnabled(game), applied: false });
    syncPatches();
  },
};

/**
 * Flip the live arm part, for perButton mode. Called from input events just before
 * a shot is fired, so it must be cheap: it rewrites one cheat slot and does NOT
 * redraw EmulatorJS' cheat menu. Returns true when the new value reached the core.
 */
export function setLiveShot(shot: ChargeShotType): boolean {
  if (!isChargeShotType(shot)) return false;

  const ejs = window.EJS_emulator as CheatManager | undefined;
  const list = ejs?.cheats;
  if (!ejs?.gameManager?.setCheat || !list || !ejs.cheatChanged) return false;
  const patch = patchesFor(state.game).find((candidate) => candidate.id === CHARGE_SHOT_PATCH_ID);
  if (!patch) return false;

  const code = resolvePatch(patch, shot).code;
  // `liveShot` records what the game actually has. It is only updated once the
  // write reached the core, so a failed switch is retried instead of mistaken
  // for done (which would fire the previous arm part).
  const alreadyLive = state.liveShot === shot && list.some((entry) => ownerOf(entry) === patch && entry.checked && entry.code === code);
  if (alreadyLive) return true;

  try {
    for (const entry of list) {
      if (ownerOf(entry) !== patch) continue;
      if (!entry.checked) {
        // the arm part is not switched on, so there is nothing to rewrite
        if (entry.code !== code) entry.code = code;
        continue;
      }
      // rewrite the enabled slot in place: off, swap, on – same index throughout
      ejs.cheatChanged(false, entry.code, list.indexOf(entry));
      ejs.cheatChanged(true, code, list.indexOf(entry));
      entry.code = code;
    }
    publish({ liveShot: shot });
    return true;
  } catch {
    return false;
  }
}

/** Called once the player has picked a file; the file name decides the game. */
export function setDetectedGame(game: GameId | null) {
  const next = game ?? state.game;
  if (game === state.detected && next === state.game) return;
  writeStored(GAME_KEY, next);
  publish({ detected: game, game: next, enabled: readEnabled(next), applied: false });
  syncPatches();
}
