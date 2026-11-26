import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { FACE_BUTTONS } from "../lib/buttons";
import { autoCharge, setBeforeFire, DUAL_BUTTONS } from "../lib/autoCharge";
import { BTN, loadEmulator, tapInput, toggleEmulatorMenu } from "../lib/emulator";
import PsIcon from "./PsIcon";
import CheatSheet from "./CheatSheet";
import PatchSheet from "./PatchSheet";
import { patches } from "../lib/patches";
import { LeftCluster, RightCluster, usePad } from "./VirtualPad";

const PAD_KEY = "ps1web.pad.visible";

function defaultPadVisible() {
  try {
    const saved = localStorage.getItem(PAD_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    /* ignore */
  }
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

function useAutoCharge() {
  return useSyncExternalStore(autoCharge.subscribe, autoCharge.getSnapshot, autoCharge.getSnapshot);
}

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const Icon = {
  back: <path d="M15 5l-7 7 7 7" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  pad: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
      <path d="M7 10.5v3M5.5 12h3" />
      <circle cx="16" cy="11" r="0.6" fill="currentColor" />
      <circle cx="18" cy="13" r="0.6" fill="currentColor" />
    </>
  ),
  bolt: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11.5H12z" />,
  key: (
    <>
      <circle cx="8.5" cy="8.5" r="4.2" />
      <path d="M11.6 11.6 19 19M16.2 16.2l2-2M18.6 18.6l1.8-1.8" />
    </>
  ),
  armor: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z" />
      <path d="M9.5 12l1.8 1.8 3.4-3.6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  load: (
    <>
      <path d="M4 14v5h16v-5" />
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    </>
  ),
  expand: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  shrink: <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
};

function ToolButton({
  label,
  title,
  icon,
  onClick,
  active,
}: {
  label: string;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      // keep keyboard focus on the game so desktop keyboard controls keep working
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={title ?? label}
      title={title}
      aria-pressed={active}
      className={`tool-btn ${active ? "is-active" : ""}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon}
      </svg>
      <span>{label}</span>
    </button>
  );
}

/**
 * Lets the player pick which action buttons charge. One or more can be on at once;
 * "雙" is a shortcut for □ + △ (X-Buster and special weapon together).
 */
function FirePicker({
  value,
  instant,
  onToggle,
  onDual,
}: {
  value: readonly number[];
  /** whether the □ and △ "instant full charge" patches are on (X4 only) */
  instant: boolean;
  onToggle: (index: number) => void;
  onDual: () => void;
}) {
  const dual = value.length === DUAL_BUTTONS.length && DUAL_BUTTONS.every((index) => value.includes(index));
  const dualTitle = instant
    ? "雙開：□ 與 △ 同時集氣，且兩邊都瞬間集滿（點一下關閉）"
    : "雙開：□ 與 △ 同時集氣，並開啟兩邊的瞬間集滿";
  return (
    <div className="fire-picker" role="group" aria-label="發射鍵（可複選）">
      <span className="fire-picker-label">發射鍵</span>
      {FACE_BUTTONS.map((b) => {
        const on = value.includes(b.index);
        const last = on && value.length === 1;
        return (
          <button
            key={b.index}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-disabled={last || undefined}
            aria-label={b.label}
            title={last ? `${b.label}（至少保留一個）` : b.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onToggle(b.index)}
            className={`fire-opt fire-${b.id} ${on ? "is-on" : ""}`}
          >
            <PsIcon id={b.id} />
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={dual}
        aria-label={
          dual && instant
            ? "雙開：方塊與三角同時集氣，瞬間集滿已開啟"
            : "雙開：方塊與三角同時集氣"
        }
        title={dualTitle}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDual}
        className={`fire-dual ${dual ? "is-on" : ""}`}
      >
        雙開
        {dual && instant && (
          <span className="fire-dual-dot" aria-hidden title="瞬間集滿已開啟" />
        )}
      </button>
    </div>
  );
}

export default function Player({ url, name }: { url: string; name: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [padOn, setPadOn] = useState(defaultPadVisible);
  const [isFs, setIsFs] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [patchOpen, setPatchOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Short message shown after an action that changes more than the player can see
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(id);
  }, [notice]);
  const patchState = useSyncExternalStore(patches.subscribe, patches.getSnapshot, patches.getSnapshot);
  const charge = useAutoCharge();
  const pad = usePad(padOn);

  const doc = document as FsDoc;
  const fsSupported = !!(document.fullscreenEnabled || doc.webkitFullscreenEnabled);

  // Boot EmulatorJS once the #game container exists
  useEffect(() => {
    loadEmulator({ url, name });
  }, [url, name]);

  // Keep hook clean and pure without interfering with normal dual charge
  useEffect(() => {
    setBeforeFire(null);
  }, []);

  // Let EmulatorJS/RetroArch re-measure after our layout changes
  useEffect(() => {
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => window.clearTimeout(id);
  }, [padOn, isFs, charge.enabled]);

  useEffect(() => {
    const onFs = () => setIsFs(!!(document.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [doc]);

  const togglePad = () => {
    setPadOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(PAD_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleFullscreen = () => {
    const el = rootRef.current as FsEl | null;
    if (!el) return;
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    } else {
      el.webkitRequestFullscreen?.();
    }
  };

  const exit = () => {
    if (window.confirm("確定要離開並更換遊戲嗎？未存檔的進度將會遺失。")) location.reload();
  };

  /**
   * 雙開 also switches on the two "instant full charge" patches on X4, so both
   * □ and △ fire charged shots at once instead of waiting for the game's own
   * charge time. Turning 雙開 off leaves the patches as they are.
   */
  const toggleDual = () => {
    const turningOn = !(
      charge.buttons.length === DUAL_BUTTONS.length &&
      DUAL_BUTTONS.every((index) => charge.buttons.includes(index))
    );
    autoCharge.toggleDual();
    if (!turningOn) return;
    if (!patches.instantChargeEnabled()) {
      const applied = patches.setInstantCharge(true);
      setNotice(applied ? "雙開：□ 與 △ 同時瞬間集滿" : "雙開已開啟；瞬間集滿會在模擬器啟動後套用");
    }
  };

  return (
    <div ref={rootRef} className={`play-root ${padOn ? "pad-on" : "pad-off"}`}>
      <div className="play-bar">
        <div className="bar-group bar-group-l">
          <ToolButton label="返回" icon={Icon.back} onClick={exit} />
          <ToolButton label="選單" icon={Icon.menu} onClick={toggleEmulatorMenu} />
          <ToolButton label="按鍵" icon={Icon.pad} onClick={togglePad} active={padOn} />
          <ToolButton
            label="集氣"
            title="自動集氣"
            icon={Icon.bolt}
            onClick={() => autoCharge.toggle()}
            active={charge.enabled}
          />
          {/* one entry point for hidden codes and memory patches */}
          <ToolButton
            label="秘技"
            icon={Icon.key}
            onClick={() => setCheatOpen(true)}
            active={patchState.enabled.length > 0}
          />
          {charge.enabled && (
            <FirePicker
              value={charge.buttons}
              instant={patches.instantChargeEnabled()}
              onToggle={autoCharge.toggleButton}
              onDual={toggleDual}
            />
          )}
        </div>

        <div className="bar-group bar-group-r">
          <ToolButton label="存檔" icon={Icon.save} onClick={() => tapInput(BTN.QUICK_SAVE)} />
          <ToolButton label="讀檔" icon={Icon.load} onClick={() => tapInput(BTN.QUICK_LOAD)} />
          {fsSupported && (
            <ToolButton
              label={isFs ? "還原" : "全螢幕"}
              icon={isFs ? Icon.shrink : Icon.expand}
              onClick={toggleFullscreen}
              active={isFs}
            />
          )}
        </div>
      </div>

      <div className="play-screen" aria-label={name}>
        <div id="game" />
      </div>

      <div className="pad-slot pad-slot-left">
        <LeftCluster pad={pad} />
      </div>
      <div className="pad-slot pad-slot-right">
        <RightCluster pad={pad} charging={charge.charging} />
      </div>

      <CheatSheet
        open={cheatOpen}
        onClose={() => setCheatOpen(false)}
        onShowPatches={() => {
          setCheatOpen(false);
          setPatchOpen(true);
        }}
        patchCount={patchState.enabled.length}
      />
      <PatchSheet
        open={patchOpen}
        onClose={() => setPatchOpen(false)}
        onShowCodes={() => {
          setPatchOpen(false);
          setCheatOpen(true);
        }}
        patchCount={patchState.enabled.length}
      />

      {notice && (
        <div className="play-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </div>
  );
}
