// Thin wrapper around EmulatorJS (loaded from its CDN at runtime)
import { coreInput, ensureInstalled, padInput } from "./autoCharge";
import { detectGame, getPatchCheats, setDetectedGame, syncPatches } from "./patches";

export { BTN } from "./buttons";

export interface EJSInstance {
  gameManager?: {
    simulateInput: (player: number, index: number, value: number) => void;
    setCheat?: (index: number, enabled: boolean, code: string) => void;
  };
  menu?: {
    toggle: () => void;
    open: (force?: boolean) => void;
    close: () => void;
  };
}

declare global {
  interface Window {
    EJS_player?: string;
    EJS_core?: string;
    EJS_gameUrl?: string;
    EJS_gameName?: string;
    EJS_pathtodata?: string;
    EJS_startOnLoaded?: boolean;
    EJS_color?: string;
    EJS_language?: string;
    EJS_defaultOptions?: Record<string, string>;
    EJS_cheats?: [string, string][];
    EJS_Buttons?: Record<string, boolean>;
    EJS_onGameStart?: () => void;
    EJS_onGameStartRaw?: () => void;
    EJS_emulator?: EJSInstance;
  }
}

export const CDN = "https://cdn.emulatorjs.org/stable/data/";

/** Button press (1) / release (0) on player 1 from the on-screen controller */
export function sendInput(index: number, value: number) {
  padInput(index, value);
}

/** Press and release an emulator shortcut, e.g. quick save / quick load */
export function tapInput(index: number) {
  ensureInstalled();
  coreInput(index, 1);
  window.setTimeout(() => coreInput(index, 0), 60);
}

export function toggleEmulatorMenu() {
  try {
    window.EJS_emulator?.menu?.toggle();
  } catch {
    /* ignore */
  }
}

let injected = false;

export function loadEmulator(opts: { url: string; name: string }) {
  if (injected) return;
  injected = true;

  window.EJS_player = "#game";
  window.EJS_core = "psx";
  window.EJS_gameUrl = opts.url;
  window.EJS_gameName = opts.name;
  window.EJS_pathtodata = CDN;
  window.EJS_startOnLoaded = true;
  window.EJS_color = "#3b82f6";
  window.EJS_language = "zh-CN";
  // Disable the built-in overlay gamepad – we render our own controls outside the screen
  window.EJS_defaultOptions = { "virtual-gamepad": "disabled", "menu-bar-button": "hidden" };
  // EmulatorJS' own fullscreen would only enlarge the game area and hide our pad
  window.EJS_Buttons = { fullscreen: false };
  // Cheat addresses differ per game, so decide which set to offer from the file
  // name before the emulator reads them
  setDetectedGame(detectGame(opts.name));
  window.EJS_cheats = getPatchCheats();
  // "start" fires once the game is running: input can be hooked and memory
  // patches take effect from the very first frame of play
  window.EJS_onGameStart = () => {
    ensureInstalled();
    syncPatches();
  };

  const s = document.createElement("script");
  s.src = CDN + "loader.js";
  document.body.appendChild(s);
}
