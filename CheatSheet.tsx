import { useEffect, useRef, useState } from "react";
import { BTN } from "../lib/buttons";
import { CONFIRM_OPTIONS, MACROS, keyViewOf, runMacro } from "../lib/macros";
import type { KeyView, MacroDef, MacroState } from "../lib/macros";
import PsIcon from "./PsIcon";

function ArrowGlyph({ dir }: { dir: "up" | "down" | "left" | "right" }) {
  const rot = { up: 0, right: 90, down: 180, left: -90 }[dir];
  return (
    <svg viewBox="0 0 12 12" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
      <path d="M6 2 10.5 8.6H1.5Z" fill="currentColor" />
    </svg>
  );
}

function KeyGlyph({ view, big }: { view: KeyView; big?: boolean }) {
  const cls = `glyph ${big ? "glyph-big" : ""}`;
  if (view.type === "face")
    return (
      <span className={`${cls} glyph-face glyph-${view.id}`}>
        <PsIcon id={view.id} />
      </span>
    );
  if (view.type === "arrow")
    return (
      <span className={`${cls} glyph-arrow`}>
        <ArrowGlyph dir={view.dir} />
      </span>
    );
  return <span className={`${cls} glyph-chip`}>{view.text}</span>;
}

function Sequence({ macro, confirmView }: { macro: MacroDef; confirmView: KeyView }) {
  return (
    <div className="seq" aria-label="指令順序">
      {macro.display(confirmView).map((item, i) =>
        "repeat" in item ? (
          <span key={i} className="seq-repeat">
            ×{item.repeat}
          </span>
        ) : (
          <KeyGlyph key={i} view={item} />
        ),
      )}
    </div>
  );
}

export default function CheatSheet({
  open,
  onClose,
  onShowPatches,
  patchCount,
}: {
  open: boolean;
  onClose: () => void;
  /** switch to the memory-patch sheet */
  onShowPatches: () => void;
  patchCount: number;
}) {
  const [confirmIdx, setConfirmIdx] = useState<number>(BTN.CIRCLE);
  const [state, setState] = useState<MacroState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const confirmView = keyViewOf(confirmIdx);

  const start = (macro: MacroDef) => {
    setToast(null);
    onClose(); // the game must be visible while the sequence is typed in
    cancelRef.current?.();
    const { cancel } = runMacro(macro.build(confirmIdx), (s) => {
      if (!aliveRef.current) return;
      setState(s);
      if (!s.running) {
        cancelRef.current = null;
        setToast(s.done ? `${macro.title} 輸入完成` : `${macro.title} 已取消`);
      }
    });
    cancelRef.current = cancel;
  };

  const busy = state?.running ?? false;

  return (
    <>
      {busy && state && (
        <div className="macro-overlay" role="status" aria-live="polite">
          <p className="macro-title">正在輸入指令</p>
          <div className="macro-glyphs">
            {state.active.length ? (
              state.active.map((i) => <KeyGlyph key={i} big view={keyViewOf(i)} />)
            ) : (
              <span className="glyph glyph-big glyph-chip">…</span>
            )}
          </div>
          <div className="macro-progress">
            <div style={{ width: `${state.total ? (state.step / state.total) * 100 : 0}%` }} />
          </div>
          <p className="macro-label">
            {state.label}
            <span>
              {state.step}/{state.total}
            </span>
          </p>
          <button type="button" className="macro-cancel" onClick={() => cancelRef.current?.()}>
            取消
          </button>
        </div>
      )}

      {toast && !busy && <div className="macro-toast">{toast}</div>}

      <div className={`sheet-scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
      <section className={`sheet ${open ? "is-open" : ""}`} role="dialog" aria-label="秘技輸入器" aria-hidden={!open} inert={!open}>
        <header className="sheet-head">
          <h2>秘技輸入器</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>

        <p className="sheet-lead">
          以下為 PlayStation <strong>日版</strong>《洛克人 X4》的隱藏指令。請先停在<strong>角色選擇畫面</strong>，把光標停在對應角色上，再按「自動輸入」。
        </p>

        <div className="sheet-tabs" role="tablist" aria-label="秘技種類">
          <button type="button" role="tab" aria-selected="true" className="sheet-tab is-on">
            隱藏指令
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            className="sheet-tab"
            onClick={onShowPatches}
          >
            金手指
            {patchCount > 0 && <span className="sheet-tab-badge">{patchCount}</span>}
          </button>
        </div>

        <div className="sheet-row">
          <span className="sheet-label">最後的決定鍵</span>
          <div className="seg" role="radiogroup" aria-label="最後的決定鍵">
            {CONFIRM_OPTIONS.map((o) => (
              <button
                key={o.index}
                type="button"
                role="radio"
                aria-checked={confirmIdx === o.index}
                className={`seg-opt ${confirmIdx === o.index ? "is-on" : ""}`}
                title={o.note}
                onClick={() => setConfirmIdx(o.index)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cheat-list">
          {MACROS.map((m) => (
            <article key={m.id} className="cheat-card">
              <div className="cheat-head">
                <h3>{m.title}</h3>
                <span className="cheat-badge">日版指令</span>
              </div>
              <p className="cheat-effect">{m.effect}</p>
              <Sequence macro={m} confirmView={confirmView} />
              <div className="cheat-foot">
                <span className="cheat-hint">{m.hint}</span>
                <button type="button" className="cheat-run" onClick={() => start(m)} disabled={busy}>
                  自動輸入
                </button>
              </div>
            </article>
          ))}
        </div>

        <button type="button" className="sheet-next" onClick={onShowPatches}>
          <span>
            <strong>想要開局就穿第四裝甲？</strong>
            <small>到「金手指」開啟「開局第四裝甲」，不必再去找改造膠囊</small>
              <small className="sheet-next-sub">
              X4 光碟內沒有獵鷹裝甲的圖像；「金手指」的「跨代:獵鷹外型能力」用 X4 自己的位址重現它的自由飛行，
              外型可選第四裝甲或究極裝甲（以隱藏旗標達成，不必手動輸入指令）。想要真正的獵鷹外型，請用「X4 獵鷹映像」光碟並在補丁裡選「獵鷹裝甲（真外型）」，或載入 X5 並開啟「獵鷹外型能力」。
            </small>
          </span>
          <span aria-hidden>›</span>
        </button>
      </section>
    </>
  );
}
