import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { BTN } from "../lib/buttons";
import type { FaceId } from "../lib/buttons";
import { sendInput } from "../lib/emulator";
import PsIcon from "./PsIcon";

/* ------------------------------------------------------------------ */
/*  Pointer tracking (multi-touch, sliding between buttons, diagonals) */
/* ------------------------------------------------------------------ */

type Tracked = { dpad: HTMLElement | null; buttons: number[] };

function dpadButtons(el: HTMLElement, x: number, y: number): number[] {
  const r = el.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2);
  const dy = y - (r.top + r.height / 2);
  const dist = Math.hypot(dx, dy);
  if (dist < r.width * 0.1) return []; // dead zone in the centre
  const nx = dx / dist;
  const ny = dy / dist;
  const T = 0.45; // ~63°: cardinal sectors are wider than diagonals
  const out: number[] = [];
  if (ny < -T) out.push(BTN.UP);
  if (ny > T) out.push(BTN.DOWN);
  if (nx < -T) out.push(BTN.LEFT);
  if (nx > T) out.push(BTN.RIGHT);
  return out;
}

function buttonsOf(el: Element | null | undefined): number[] {
  const hit = el?.closest<HTMLElement>("[data-btn]");
  if (!hit?.dataset.btn) return [];
  return hit.dataset.btn.split(",").map(Number);
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface PadApi {
  pressed: Set<number>;
  bind: {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: RPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: RPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: RPointerEvent<HTMLElement>) => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
}

export function usePad(enabled: boolean, haptics = true): PadApi {
  const pointers = useRef(new Map<number, Tracked>());
  const active = useRef(new Set<number>());
  const [pressed, setPressed] = useState<Set<number>>(() => new Set());

  const sync = useCallback(() => {
    const next = new Set<number>();
    pointers.current.forEach((p) => p.buttons.forEach((b) => next.add(b)));
    let newPress = false;
    next.forEach((b) => {
      if (!active.current.has(b)) {
        sendInput(b, 1);
        newPress = true;
      }
    });
    active.current.forEach((b) => {
      if (!next.has(b)) sendInput(b, 0);
    });
    if (newPress && haptics && "vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore */
      }
    }
    active.current = next;
    setPressed(new Set(next));
  }, [haptics]);

  const releaseAll = useCallback(() => {
    pointers.current.clear();
    sync();
  }, [sync]);

  // Release everything when hidden / app loses focus, so no button gets "stuck"
  useEffect(() => {
    if (!enabled) releaseAll();
  }, [enabled, releaseAll]);

  useEffect(() => {
    const onHide = () => releaseAll();
    const onVis = () => document.hidden && releaseAll();
    window.addEventListener("blur", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [releaseAll]);

  const bind = useMemo<PadApi["bind"]>(() => {
    const end = (e: RPointerEvent<HTMLElement>) => {
      if (pointers.current.delete(e.pointerId)) sync();
    };
    return {
      onPointerDown: (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>("[data-dpad],[data-btn]");
        e.preventDefault();
        if (!target) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const isDpad = target.hasAttribute("data-dpad");
        pointers.current.set(e.pointerId, {
          dpad: isDpad ? target : null,
          buttons: isDpad ? dpadButtons(target, e.clientX, e.clientY) : buttonsOf(target),
        });
        sync();
      },
      onPointerMove: (e) => {
        const p = pointers.current.get(e.pointerId);
        if (!p) return;
        const next = p.dpad
          ? dpadButtons(p.dpad, e.clientX, e.clientY)
          : buttonsOf(document.elementFromPoint(e.clientX, e.clientY));
        if (!same(next, p.buttons)) {
          p.buttons = next;
          sync();
        }
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
      onContextMenu: (e) => e.preventDefault(),
    };
  }, [sync]);

  return { pressed, bind };
}

/* ------------------------------------------------------------------ */
/*  Visual pieces                                                      */
/* ------------------------------------------------------------------ */

function DPad({ pressed }: { pressed: Set<number> }) {
  const arm = (idx: number, cls: string, rot: number) => (
    <div className={`dpad-arm ${cls} ${pressed.has(idx) ? "is-on" : ""}`}>
      <svg viewBox="0 0 10 10" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
        <path d="M5 2.2 L8 6.8 H2 Z" fill="currentColor" />
      </svg>
    </div>
  );
  return (
    <div className="dpad" data-dpad aria-label="方向鍵" role="group">
      {arm(BTN.UP, "dpad-up", 0)}
      {arm(BTN.LEFT, "dpad-left", -90)}
      <div className="dpad-center" />
      {arm(BTN.RIGHT, "dpad-right", 90)}
      {arm(BTN.DOWN, "dpad-down", 180)}
    </div>
  );
}

const FACE: { index: number; id: FaceId; cls: string; label: string }[] = [
  { index: BTN.TRIANGLE, id: "triangle", cls: "face-tri", label: "三角" },
  { index: BTN.SQUARE, id: "square", cls: "face-sq", label: "方塊" },
  { index: BTN.CIRCLE, id: "circle", cls: "face-ci", label: "圓圈" },
  { index: BTN.CROSS, id: "cross", cls: "face-x", label: "叉叉" },
];

function FaceButtons({ pressed, charging: chargingNow }: { pressed: Set<number>; charging: readonly number[] }) {
  return (
    <div className="face" role="group" aria-label="動作鍵">
      {FACE.map((b) => {
        const down = pressed.has(b.index);
        // glows while auto-charge is holding this button
        const charging = chargingNow.includes(b.index) && !down;
        return (
          <div key={b.index} className={`face-cell ${b.cls}`} data-btn={b.index} aria-label={b.label}>
            <div className={`face-btn ${down ? "is-on" : ""} ${charging ? "is-charging" : ""}`}>
              <PsIcon id={b.id} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pill({ idx, label, pressed, kind }: { idx: number; label: string; pressed: Set<number>; kind: "shoulder" | "meta" }) {
  return (
    <div className={`pill-hit pill-${kind}`} data-btn={idx}>
      <div className={`pill ${pressed.has(idx) ? "is-on" : ""}`}>{label}</div>
    </div>
  );
}

export function LeftCluster({ pad }: { pad: PadApi }) {
  const { pressed, bind } = pad;
  return (
    <div className="pad-cluster pad-left" {...bind}>
      <div className="pad-row pad-row-shoulder">
        <Pill idx={BTN.L2} label="L2" pressed={pressed} kind="shoulder" />
        <Pill idx={BTN.L1} label="L1" pressed={pressed} kind="shoulder" />
      </div>
      <DPad pressed={pressed} />
      <div className="pad-row pad-row-meta">
        <Pill idx={BTN.SELECT} label="SELECT" pressed={pressed} kind="meta" />
      </div>
    </div>
  );
}

export function RightCluster({ pad, charging }: { pad: PadApi; charging: readonly number[] }) {
  const { pressed, bind } = pad;
  return (
    <div className="pad-cluster pad-right" {...bind}>
      <div className="pad-row pad-row-shoulder">
        <Pill idx={BTN.R1} label="R1" pressed={pressed} kind="shoulder" />
        <Pill idx={BTN.R2} label="R2" pressed={pressed} kind="shoulder" />
      </div>
      <FaceButtons pressed={pressed} charging={charging} />
      <div className="pad-row pad-row-meta">
        <Pill idx={BTN.START} label="START" pressed={pressed} kind="meta" />
      </div>
    </div>
  );
}
