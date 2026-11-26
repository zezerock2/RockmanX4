import { BTN } from "./buttons";
import type { FaceId } from "./buttons";
import { coreInput, setMacroSuspended } from "./autoCharge";

/* ------------------------------------------------------------------ */
/*  Cheat sequences for Rockman X4 (PlayStation, Japanese version)     */
/*  Sources: RMMH (Japanese fan site), Mega Man Wiki, GameFAQs.        */
/*  In Japan ○ confirms and ✕ cancels; in the US release these are     */
/*  swapped, so the same code is written with other buttons there.     */
/* ------------------------------------------------------------------ */

/** How a button is drawn in the sequence list and in the input overlay */
export type KeyView =
  | { type: "face"; id: FaceId }
  | { type: "arrow"; dir: "up" | "down" | "left" | "right" }
  | { type: "chip"; text: string };

const FACE = (id: FaceId): KeyView => ({ type: "face", id });
const ARROW = (dir: "up" | "down" | "left" | "right"): KeyView => ({ type: "arrow", dir });
const CHIP = (text: string): KeyView => ({ type: "chip", text });

/** Icon + label for any input index, used while a sequence is being typed */
export function keyViewOf(index: number): KeyView {
  switch (index) {
    case BTN.CROSS:
      return FACE("cross");
    case BTN.SQUARE:
      return FACE("square");
    case BTN.CIRCLE:
      return FACE("circle");
    case BTN.TRIANGLE:
      return FACE("triangle");
    case BTN.UP:
      return ARROW("up");
    case BTN.DOWN:
      return ARROW("down");
    case BTN.LEFT:
      return ARROW("left");
    case BTN.RIGHT:
      return ARROW("right");
    case BTN.L1:
      return CHIP("L1");
    case BTN.R1:
      return CHIP("R1");
    case BTN.L2:
      return CHIP("L2");
    case BTN.R2:
      return CHIP("R2");
    case BTN.START:
      return CHIP("START");
    default:
      return CHIP("SELECT");
  }
}

/** One block of the sequence: `hold` buttons stay down across the taps */
export type MacroPhase = {
  hold?: number[];
  taps: number[];
  /** ms each tap stays down */
  tapMs?: number;
  /** ms between taps */
  gap?: number;
  /** ms `hold` stays down after the last tap */
  holdAfter?: number;
};

export type MacroState = {
  running: boolean;
  done: boolean;
  step: number;
  total: number;
  active: number[];
  label: string;
};

export type MacroDef = {
  id: string;
  title: string;
  effect: string;
  hint: string;
  /** how the sequence reads, for display only */
  display: (confirm: KeyView) => (KeyView | { repeat: number })[];
  build: (confirm: number) => MacroPhase[];
};

const LEFTS: number[] = [BTN.LEFT, BTN.LEFT, BTN.LEFT, BTN.LEFT, BTN.LEFT, BTN.LEFT];
const RIGHTS: number[] = [BTN.RIGHT, BTN.RIGHT, BTN.RIGHT, BTN.RIGHT, BTN.RIGHT, BTN.RIGHT];

export const MACROS: MacroDef[] = [
  {
    id: "ultimate-x",
    title: "X 究極裝甲",
    effect: "輸入成功後 X 的緊身衣會變成紫色；到任一改造膠囊（磁網蜘蛛關最簡單）就會取得全套究極裝甲，NOVA STRIKE 無限使用。",
    hint: "請停在角色選擇畫面，光標停在 X 上",
    display: (confirm) => [FACE("cross"), FACE("cross"), ARROW("left"), { repeat: 6 }, CHIP("L1+R2"), confirm],
    build: (confirm) => [
      { taps: [BTN.CROSS, BTN.CROSS], gap: 300 },
      { taps: LEFTS, gap: 230 },
      { hold: [BTN.L1, BTN.R2], taps: [confirm], tapMs: 150, holdAfter: 1800 },
    ],
  },
  {
    id: "black-zero",
    title: "Zero 黑裝甲",
    effect: "傑洛全身變黑，純粹外觀變化，沒有能力加成。開始遊戲即可使用。",
    hint: "請停在角色選擇畫面，光標停在傑洛上",
    display: (confirm) => [CHIP("按住R1"), ARROW("right"), { repeat: 6 }, CHIP("放開R1"), CHIP("按住✕"), confirm],
    build: (confirm) => [
      { hold: [BTN.R1], taps: RIGHTS, gap: 230, holdAfter: 90 },
      { hold: [BTN.CROSS], taps: [confirm], tapMs: 150, holdAfter: 900 },
    ],
  },
];

/** A button that finishes the sequence on the Japanese release (○ = 決定) */
export const CONFIRM_OPTIONS = [
  { index: BTN.CIRCLE, label: "○", note: "日版決定鍵" },
  { index: BTN.START, label: "START", note: "另一種寫法" },
];

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Type the sequence into the game. Auto-charge is suspended while it runs, so it
 * cannot keep a button pressed and ruin the code.
 */
export function runMacro(phases: MacroPhase[], onUpdate: (s: MacroState) => void) {
  const token = { cancelled: false };
  const total = phases.reduce((n, p) => n + p.taps.length, 0);
  const active = new Set<number>();
  let step = 0;

  const down = (i: number) => {
    if (active.has(i)) return;
    active.add(i);
    coreInput(i, 1);
  };
  const up = (i: number) => {
    if (!active.has(i)) return;
    active.delete(i);
    coreInput(i, 0);
  };
  const emit = (label: string) =>
    onUpdate({ running: true, done: false, step, total, active: [...active], label });

  const wait = async (ms: number) => {
    const end = Date.now() + ms;
    while (!token.cancelled && Date.now() < end) await sleep(Math.min(30, Math.max(5, end - Date.now())));
  };

  void (async () => {
    setMacroSuspended(true);
    try {
      for (const phase of phases) {
        if (token.cancelled) break;
        for (const b of phase.hold ?? []) {
          down(b);
          emit(`按住 ${labelOf(b)}`);
        }
        for (const tap of phase.taps) {
          if (token.cancelled) break;
          step += 1;
          down(tap);
          emit(`按下 ${labelOf(tap)}`);
          await wait(phase.tapMs ?? 110);
          up(tap);
          await wait(phase.gap ?? 230);
        }
        if (phase.holdAfter) await wait(phase.holdAfter);
        for (const b of phase.hold ?? []) up(b);
      }
    } finally {
      [...active].forEach(up);
      setMacroSuspended(false);
      onUpdate({
        running: false,
        done: !token.cancelled,
        step,
        total,
        active: [],
        label: token.cancelled ? "已取消" : "輸入完成",
      });
    }
  })();

  return { cancel: () => (token.cancelled = true) };
}

function labelOf(index: number): string {
  const view = keyViewOf(index);
  if (view.type === "chip") return view.text;
  if (view.type === "arrow") return { up: "↑", down: "↓", left: "←", right: "→" }[view.dir];
  return { cross: "✕", square: "□", circle: "○", triangle: "△" }[view.id];
}
