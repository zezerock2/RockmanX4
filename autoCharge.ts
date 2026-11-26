import { BTN, FACE_BUTTONS } from "./buttons";
import { patches, setLiveShot } from "./patches";

/** EmulatorJS' `gameManager.simulateInput(player, buttonIndex, value)` */
type Sim = (player: number, index: number, value: number) => void;
type Hookable = { simulateInput: Sim; autoChargeHook?: boolean };

/** RetroPad buttons 0-15 are the digital ones; 16-23 are analog axes and 24+ are EmulatorJS shortcuts. */
const DIGITAL_MAX = 16;
/** A quick tap keeps the shot button released at least this long, so the game always sees it (about 6 frames). */
const MIN_RELEASE_MS = 100;
const KEY_ON = "ps1web.autoCharge.on";
/** Current format: JSON list of button indexes. */
const KEY_BUTTONS = "ps1web.autoCharge.buttons";
/** Old format: one button index. Still read once so nobody loses their choice. */
const KEY_BUTTON_LEGACY = "ps1web.autoCharge.button";

/** Mega Man X4 fires with □ on PlayStation */
export const DEFAULT_BUTTONS: readonly number[] = [BTN.SQUARE];
/** 雙開: the X-Buster (□) and the special weapon (△) charge at the same time completely independently */
export const DUAL_BUTTONS: readonly number[] = [BTN.TRIANGLE, BTN.SQUARE];

export interface AutoChargeState {
  enabled: boolean;
  /** buttons that are held for you, in controller order; never empty */
  buttons: readonly number[];
  /** the subset that auto-charge is actually holding down right now */
  charging: readonly number[];
  /** buttons the player pressed whose shot is still waiting for the game to be ready */
  pending: readonly number[];
}

const FACE_ORDER = FACE_BUTTONS.map((b) => b.index);

/** Keeps only real face buttons, once each, in controller order. Falls back to the default. */
function normalize(list: readonly unknown[]): readonly number[] {
  const picked = FACE_ORDER.filter((index) => list.includes(index));
  return picked.length ? picked : DEFAULT_BUTTONS;
}

function sameList(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function initialButtons(): readonly number[] {
  const raw = stored(KEY_BUTTONS);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      /* fall through to the old format */
    }
  }
  const legacy = stored(KEY_BUTTON_LEGACY);
  return legacy === null ? DEFAULT_BUTTONS : normalize([Number(legacy)]);
}

/** What is physically pressed right now, per input source and button index */
const ext = new Map<number, boolean>(); // keyboard, USB/Bluetooth gamepads, EmulatorJS' own UI
const pad = new Map<number, boolean>(); // our on-screen controller

let real: Sim | null = null;

/**
 * Isolated per-button channels: each button manages its own independent timer and hold status.
 * Actions on button A NEVER touch or re-evaluate timers or states of button B.
 */
const written = new Map<number, number>();
const wasHeld = new Map<number, boolean>();
const releaseUntil = new Map<number, number>();
const timers = new Map<number, number>();

/** Optional hook for external preparation before button firing */
export type BeforeFire = (index: number) => boolean;
let beforeFire: BeforeFire | null = null;

export function setBeforeFire(hook: BeforeFire | null) {
  beforeFire = hook;
}

/**
 * Trigger arm-part switch if running in per-button mode.
 * Works for both AUTO-CHARGE release and MANUAL (自行集氣) press/release.
 */
export function handleButtonArmSwitch(index: number) {
  const now = patches.getSnapshot();
  if (now.game !== "x4" || now.chargeShotMode !== "perButton") return true;
  const button = index === BTN.SQUARE ? "square" : index === BTN.TRIANGLE ? "triangle" : null;
  if (!button) return true;
  if (!now.enabled.includes("buster-type")) return true;
  return setLiveShot(patches.shotForButton(button));
}

/**
 * While a cheat sequence is typed in, auto-charge steps aside: a button it keeps
 * pressed would ruin the code.
 */
let suspended = false;
export function setMacroSuspended(value: boolean) {
  if (suspended === value) return;
  suspended = value;
  if (real) {
    for (const index of FACE_ORDER) {
      applyButton(index);
    }
    syncState();
  }
}

let state: AutoChargeState = {
  enabled: stored(KEY_ON) === "1",
  buttons: initialButtons(),
  charging: [],
  pending: [],
};
const listeners = new Set<() => void>();

function publish(patch: Partial<AutoChargeState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function toGame(index: number, value: number) {
  try {
    real?.(0, index, value);
  } catch {
    /* the game is not running yet */
  }
}

function held(index: number) {
  return ext.get(index) === true || pad.get(index) === true;
}

/** True when auto-charge owns this button's output right now. */
function managing(index: number) {
  return state.enabled && !suspended && state.buttons.includes(index);
}

function write(index: number, value: number) {
  if (written.get(index) === value) return;
  written.set(index, value);
  toGame(index, value);
}

/**
 * Update state.charging and state.pending based on current channels
 */
function syncState() {
  const charging: number[] = [];
  for (const index of FACE_ORDER) {
    if (!managing(index)) continue;
    if (written.get(index) === 1 && !held(index) && (releaseUntil.get(index) ?? 0) <= Date.now()) {
      charging.push(index);
    }
  }
  if (!sameList(charging, state.charging)) {
    publish({ charging });
  }
}

/**
 * Apply logic for a SINGLE button completely independently.
 * Touching button A never cancels timers or alters states for button B.
 */
function applyButton(index: number) {
  if (!real) return;

  const currentTimer = timers.get(index);
  if (currentTimer !== undefined) {
    window.clearTimeout(currentTimer);
    timers.delete(index);
  }

  if (!managing(index)) {
    if (written.has(index)) {
      toGame(index, held(index) ? 1 : 0);
      written.delete(index);
    }
    wasHeld.delete(index);
    releaseUntil.delete(index);
    return;
  }

  if (held(index)) {
    const fresh = !wasHeld.get(index);
    const needsFire = fresh || state.pending.includes(index);
    wasHeld.set(index, true);

    if (needsFire) {
      handleButtonArmSwitch(index);
    }

    if (needsFire && beforeFire && !beforeFire(index)) {
      if (!state.pending.includes(index)) {
        publish({ pending: [...state.pending, index] });
      }
      write(index, 1);
      return;
    }

    if (state.pending.includes(index)) {
      publish({ pending: state.pending.filter((b) => b !== index) });
    }

    if (needsFire) {
      releaseUntil.set(index, Date.now() + MIN_RELEASE_MS);
    }
    write(index, 0);
    return;
  }

  wasHeld.set(index, false);
  const wait = (releaseUntil.get(index) ?? 0) - Date.now();
  if (wait > 0) {
    timers.set(
      index,
      window.setTimeout(() => {
        applyButton(index);
        syncState();
      }, wait + 5)
    );
    return;
  }

  write(index, 1);
}

/**
 * Apply to all managed buttons (used when enabling/disabling or upon hook install)
 */
function apply() {
  if (!real) return;
  for (const index of FACE_ORDER) {
    applyButton(index);
  }
  syncState();
}

/**
 * Watch every button press on the way to the game, whichever device it comes from.
 * Safe to call often; returns true once the emulator can receive input.
 */
export function ensureInstalled(): boolean {
  const gm = window.EJS_emulator?.gameManager as Hookable | undefined;
  if (!gm) return false;
  if (gm.autoChargeHook) return true;

  const original = gm.simulateInput.bind(gm);
  gm.autoChargeHook = true;
  gm.simulateInput = (player, index, value) => {
    if (player === 0 && index < DIGITAL_MAX) ext.set(index, value > 0.5);
    if (player === 0 && managing(index)) {
      // ONLY apply to the specific button being pressed/released! Zero cross-talk!
      applyButton(index);
      syncState();
    } else {
      // Manual input (when autoCharge is disabled or for unmanaged buttons):
      // When pressing down (value > 0.5), switch arm part immediately so manual charging begins with correct type.
      // Also switch on release so release shot also fires with correct type.
      if (player === 0) {
        handleButtonArmSwitch(index);
      }
      original(player, index, value);
    }
  };
  real = original;
  written.clear();
  wasHeld.clear();
  releaseUntil.clear();
  if (state.pending.length) publish({ pending: [] });
  if (state.enabled) apply();
  return true;
}

/** Button press from our on-screen controller */
export function padInput(index: number, value: number) {
  if (!ensureInstalled()) return;
  if (index < DIGITAL_MAX) pad.set(index, value > 0.5);
  if (managing(index)) {
    // ONLY apply to this specific button!
    applyButton(index);
    syncState();
    return;
  }
  // Manual button input on the virtual pad
  handleButtonArmSwitch(index);
  toGame(index, value);
}

/** Button press that auto-charge must leave alone (emulator shortcuts such as quick save) */
export function coreInput(index: number, value: number) {
  if (ensureInstalled()) toGame(index, value);
}

function refresh() {
  if (ensureInstalled()) apply();
  else if (state.charging.length || state.pending.length) publish({ charging: [], pending: [] });
}

function setEnabled(enabled: boolean) {
  if (enabled === state.enabled) return;
  releaseUntil.clear();
  publish({ enabled });
  store(KEY_ON, enabled ? "1" : "0");
  refresh();
}

/** Replace the whole selection (an empty or invalid list falls back to the default). */
function setButtons(indexes: readonly number[]) {
  const next = normalize(indexes);
  if (sameList(next, state.buttons)) return;
  releaseUntil.clear();
  publish({ buttons: next });
  store(KEY_BUTTONS, JSON.stringify(next));
  refresh();
}

/** Add or remove one button. The last remaining button cannot be removed. */
function toggleButton(index: number) {
  if (!FACE_ORDER.includes(index)) return;
  if (state.buttons.includes(index)) {
    if (state.buttons.length === 1) return;
    setButtons(state.buttons.filter((b) => b !== index));
  } else {
    setButtons([...state.buttons, index]);
  }
}

/** 雙開 on/off: □ + △ together, or back to □ alone. */
function toggleDual() {
  setButtons(sameList(state.buttons, DUAL_BUTTONS) ? DEFAULT_BUTTONS : DUAL_BUTTONS);
}

export const autoCharge = {
  subscribe,
  getSnapshot,
  toggle: () => setEnabled(!state.enabled),
  setEnabled,
  setButtons,
  toggleButton,
  toggleDual,
  retryPending: () => {
    if (state.pending.length && real) {
      for (const index of state.pending) {
        applyButton(index);
      }
      syncState();
    }
  },
};

// No key can stay held once the window loses focus. Without this, a missed key-up
// (switching windows while pressing the shot button) would stop charging for good.
function forgetExternal() {
  ext.clear();
  if (real) apply();
}
window.addEventListener("blur", forgetExternal);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) forgetExternal();
});
