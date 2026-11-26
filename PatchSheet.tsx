import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import FalconLook from "./FalconLook";
import {
  CHARGE_SHOTS,
  GAMES,
  X4_EXTRA_GROUPS,
  X4_EXTRA_WRITES,
  X4_FALCON_PATCH_ID,
  X4_OUTFITS,
  patches,
  patchesFor,
  resolvePatch,
  syncPatches,
} from "../lib/patches";
import type { ChargeShotMode, ChargeShotType, GameId, Patch, X4ExtraId, X4Outfit } from "../lib/patches";

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`patch-switch ${on ? "is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="patch-knob" />
    </button>
  );
}

const SHOT_SHORT: Record<ChargeShotType, string> = { stock: "四連發", plasma: "電漿炮" };
const PS_GLYPH = { square: "□", triangle: "△" } as const;

/** One row per attack button: "□ → 四連發". Used in perButton mode. */
function ButtonShotRow({
  glyph,
  title,
  value,
  disabled,
  onChange,
}: {
  glyph: string;
  title: string;
  value: ChargeShotType;
  disabled: boolean;
  onChange: (value: ChargeShotType) => void;
}) {
  return (
    <div className={`shot-row ${disabled ? "is-disabled" : ""}`}>
      <span className="shot-row-key" aria-hidden>
        {glyph}
      </span>
      <span className="shot-row-title">
        <strong>{title}</strong>
      </span>
      <div className="seg shot-row-seg" role="radiogroup" aria-label={`${glyph} ${title}的彈種`}>
        {CHARGE_SHOTS.map((shot) => (
          <button
            key={shot.id}
            type="button"
            role="radio"
            aria-checked={value === shot.id}
            disabled={disabled}
            className={`seg-opt ${value === shot.id ? "is-on" : ""}`}
            onClick={() => onChange(shot.id)}
          >
            {SHOT_SHORT[shot.id]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChargeShotPicker({
  state,
  applied,
  onSelect,
  onMode,
  onAssign,
}: {
  state: {
    chargeShot: ChargeShotType;
    chargeShotMode: ChargeShotMode;
    squareShot: ChargeShotType;
    triangleShot: ChargeShotType;
    liveShot: ChargeShotType;
  };
  applied: boolean;
  onSelect: (value: ChargeShotType) => void;
  onMode: (mode: ChargeShotMode) => void;
  onAssign: (button: "square" | "triangle", shot: ChargeShotType) => void;
}) {
  const name = useId();
  const perButton = state.chargeShotMode === "perButton";
  const selected = CHARGE_SHOTS.find((shot) => shot.id === state.chargeShot)!;
  const same = state.squareShot === state.triangleShot;

  return (
    <fieldset className="shot-picker">
      <legend className="shot-legend">集氣彈種類</legend>

      <div className="seg shot-mode" role="radiogroup" aria-label="彈種模式">
        <button
          type="button"
          role="radio"
          aria-checked={!perButton}
          className={`seg-opt ${!perButton ? "is-on" : ""}`}
          onClick={() => onMode("single")}
        >
          單一彈種
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={perButton}
          className={`seg-opt ${perButton ? "is-on" : ""}`}
          onClick={() => onMode("perButton")}
        >
          雙彈種（各配一鍵）
        </button>
      </div>

      {perButton ? (
        <div className="shot-rows">
          <ButtonShotRow
            glyph={PS_GLYPH.square}
            title="方塊（X 彈）"
            value={state.squareShot}
            disabled={false}
            onChange={(shot) => onAssign("square", shot)}
          />
          <ButtonShotRow
            glyph={PS_GLYPH.triangle}
            title="三角（特殊武器）"
            value={state.triangleShot}
            disabled={false}
            onChange={(shot) => onAssign("triangle", shot)}
          />
          <p className="shot-picker-hint" role="status" aria-live="polite">
            {same
              ? "兩個鍵目前是同一種彈，把它們設成不同才看得出差別。"
              : `□ 射${SHOT_SHORT[state.squareShot]}、△ 射${SHOT_SHORT[state.triangleShot]}，按下該鍵時自動切換手部零件。`}
          </p>
        </div>
      ) : (
        <>
          <div className="shot-options">
            {CHARGE_SHOTS.map((shot) => (
              <label key={shot.id} className={`shot-option ${state.chargeShot === shot.id ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name={name}
                  value={shot.id}
                  checked={state.chargeShot === shot.id}
                  onChange={() => onSelect(shot.id)}
                />
                <span>
                  <strong>{shot.label}</strong>
                  <small>{shot.description}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="shot-picker-hint" role="status" aria-live="polite">
            {applied
              ? `已選擇${selected.label}，設定已送至模擬器。`
              : "已記住彈種，模擬器就緒後套用。"}
          </p>
        </>
      )}
    </fieldset>
  );
}

/** X4 跨代獵鷹的外型：第四裝甲、究極裝甲，或（用獵鷹映像時）獵鷹真外型。 */
function OutfitPicker({
  value,
  applied,
  onSelect,
}: {
  value: X4Outfit;
  applied: boolean;
  onSelect: (value: X4Outfit) => void;
}) {
  const name = useId();
  const selected = X4_OUTFITS.find((option) => option.id === value)!;
  return (
    <fieldset className="shot-picker">
      <legend className="shot-legend">外型</legend>
      <div className="shot-options">
        {X4_OUTFITS.map((option) => (
          <label key={option.id} className={`shot-option ${value === option.id ? "is-selected" : ""}`}>
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onSelect(option.id)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="shot-picker-hint" role="status" aria-live="polite">
        {applied ? `外型：${selected.label}，設定已送至模擬器。` : `外型：${selected.label}，模擬器就緒後套用。`}
        {" "}獵鷹真外型需使用「X4 獵鷹映像」光碟；原版 X4 光碟請選第四或究極裝甲。
      </p>
    </fieldset>
  );
}

/** 額外寫入：附加在跨代獵鷹補丁上的 X4 位址，分「能力」與「外型」兩類，每一項都標出它重現的獵鷹特性。 */
function ExtraWritesPicker({
  enabled,
  applied,
  outfit,
  onToggle,
  onSetAll,
}: {
  enabled: readonly string[];
  applied: boolean;
  outfit: X4Outfit;
  onToggle: (id: X4ExtraId, on: boolean) => void;
  onSetAll: (ids: readonly X4ExtraId[]) => void;
}) {
  const countOf = (group: string) =>
    X4_EXTRA_WRITES.filter((extra) => extra.group === group && enabled.includes(extra.id)).length;
  const abilityCount = countOf("ability");
  const appearanceCount = countOf("appearance");
  const total = enabled.length;
  return (
    <fieldset className="shot-picker">
      <legend className="shot-legend">額外寫入</legend>
      {X4_EXTRA_GROUPS.map((group) => {
        const items = X4_EXTRA_WRITES.filter((extra) => extra.group === group.id);
        const count = items.filter((extra) => enabled.includes(extra.id)).length;
        const allOn = count === items.length;
        return (
          <div key={group.id} className="extra-group">
            <p className="extra-group-title">
              <span className="extra-group-name">{group.label}</span>
              <span className="extra-group-hint">{group.hint}</span>
              <span className="extra-group-count" aria-label={`已選 ${count} 項，共 ${items.length} 項`}>
                {count}/{items.length}
              </span>
              <button
                type="button"
                className="extra-group-toggle"
                onClick={() => onSetAll(allOn ? [] : items.map((extra) => extra.id))}
                aria-label={allOn ? `${group.label}全不選` : `${group.label}全選`}
              >
                {allOn ? "全不選" : "全選"}
              </button>
            </p>
            <div className="shot-options extra-options">
              {items.map((extra) => {
                const on = enabled.includes(extra.id);
                return (
                  <label key={extra.id} className={`shot-option ${on ? "is-selected" : ""}`}>
                    <input type="checkbox" checked={on} onChange={(e) => onToggle(extra.id, e.target.checked)} />
                    <span>
                      <strong>
                        {extra.label}
                        <span className="extra-trait">{extra.falcon}</span>
                        <code className="extra-code">{extra.code}</code>
                      </strong>
                      <small>{extra.description}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            {group.id === "ability" && (
              <p className="extra-pair">
                搭配建議：
                {outfit === "ultimate"
                  ? "究極外型在原作中固定使用電漿彈（穿透），與射擊類兩項正是針狀集氣彈的組合。"
                  : "射擊類兩項建議把「集氣彈種類」切為電漿炮（穿透，最接近針狀集氣彈）；想用原作固定的究極電漿彈可把上方外型切為究極裝甲。"}
              </p>
            )}
          </div>
        );
      })}
      <p className="shot-picker-hint" role="status" aria-live="polite">
        {total === 0
          ? "未勾選額外寫入，補丁只寫入裝甲與飛行三個位址。"
          : applied
            ? `已額外寫入能力 ${abilityCount} 項、外型 ${appearanceCount} 項，與補丁同一個金手指槽位一起送至模擬器。`
            : `已記住能力 ${abilityCount} 項、外型 ${appearanceCount} 項，模擬器就緒後一併套用。`}
      </p>
    </fieldset>
  );
}

function PatchCard({
  patch,
  on,
  applied,
  onToggle,
  children,
}: {
  patch: Patch;
  on: boolean;
  applied: boolean;
  onToggle: (v: boolean) => void;
  children?: ReactNode;
}) {
  const [showCode, setShowCode] = useState(false);
  return (
    <article className={`cheat-card patch-card ${on ? "is-on" : ""}`}>
      <div className="cheat-head">
        <h3>{patch.title}</h3>
        <Switch on={on} onChange={onToggle} label={patch.title} />
      </div>
      <p className="cheat-effect">{patch.effect}</p>
      {children}
      {patch.caution && <p className="patch-caution">{patch.caution}</p>}
      <div className="cheat-foot">
        <button type="button" className="patch-code-toggle" onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}>
          {showCode ? "隱藏金手指碼" : "顯示金手指碼"}
        </button>
        {on && <span className="patch-state">{applied ? "✓ 已啟用" : "模擬器啟動後套用"}</span>}
      </div>
      {showCode && <code className="patch-code">{patch.readable}</code>}
    </article>
  );
}

export default function PatchSheet({
  open,
  onClose,
  onShowCodes,
  patchCount,
}: {
  open: boolean;
  onClose: () => void;
  /** switch back to the hidden-code sheet */
  onShowCodes: () => void;
  /** number of active patches, shown on the "金手指" tab */
  patchCount: number;
}) {
  const state = useSyncExternalStore(patches.subscribe, patches.getSnapshot, patches.getSnapshot);
  const [nowApplied, setNowApplied] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  // The emulator is created after the game file is chosen and becomes ready some
  // time later, so re-apply whenever the sheet is opened or the game reports in.
  useEffect(() => {
    if (!open) return;
    setNowApplied(syncPatches());
    const id = window.setInterval(() => {
      if (!openRef.current) return;
      if (syncPatches()) {
        setNowApplied(true);
        window.clearInterval(id);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [open]);

  const toggle = (id: string, v: boolean) => {
    patches.set(id, v);
    setNowApplied(syncPatches());
  };

  const selectChargeShot = (shot: ChargeShotType) => {
    patches.setChargeShot(shot);
    setNowApplied(syncPatches());
  };

  const selectMode = (mode: ChargeShotMode) => {
    patches.setChargeShotMode(mode);
    // perButton only does something while the arm-part patch is writing to memory
    if (mode === "perButton") patches.set("buster-type", true);
    setNowApplied(syncPatches());
  };

  const assignButtonShot = (button: "square" | "triangle", shot: ChargeShotType) => {
    patches.setButtonShot(button, shot);
  };

  const selectOutfit = (outfit: X4Outfit) => {
    patches.setX4Outfit(outfit);
    setNowApplied(syncPatches());
  };

  const toggleExtra = (id: X4ExtraId, on: boolean) => {
    patches.setX4Extra(id, on);
    setNowApplied(syncPatches());
  };

  const setAllExtras = (ids: readonly X4ExtraId[]) => {
    patches.setX4Extras(ids);
    setNowApplied(syncPatches());
  };

  const selectGame = (game: GameId) => {
    patches.setGame(game);
    setNowApplied(syncPatches());
  };

  const falconOn = patches.falconPresetEnabled();
  const toggleFalconPreset = () => {
    patches.setFalconPreset(!falconOn);
    setNowApplied(syncPatches());
  };

  const gaiaOn = patches.gaiaPresetEnabled();
  const toggleGaiaPreset = () => {
    patches.setGaiaPreset(!gaiaOn);
    setNowApplied(syncPatches());
  };

  const activeCount = state.enabled.length;
  const current = GAMES.find((game) => game.id === state.game)!;
  const mismatch = state.detected !== null && state.detected !== state.game;

  return (
    <>
      <div className={`sheet-scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
      <section className={`sheet sheet-patches ${open ? "is-open" : ""}`} role="dialog" aria-label="金手指" aria-hidden={!open} inert={!open}>
        <header className="sheet-head">
          <h2>金手指</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>

        <div className="sheet-tabs" role="tablist" aria-label="秘技種類">
          <button type="button" role="tab" aria-selected="false" className="sheet-tab" onClick={onShowCodes}>
            隱藏指令
          </button>
          <button type="button" role="tab" aria-selected="true" className="sheet-tab is-on">
            金手指
            {patchCount > 0 && <span className="sheet-tab-badge">{patchCount}</span>}
          </button>
        </div>

        <div className="sheet-row sheet-row-game">
          <span className="sheet-label">遊戲</span>
          <div className="seg" role="radiogroup" aria-label="遊戲片別">
            {GAMES.map((game) => (
              <button
                key={game.id}
                type="button"
                role="radio"
                aria-checked={state.game === game.id}
                title={`PS 日版 ${game.serial}`}
                onClick={() => selectGame(game.id)}
                className={`seg-opt ${state.game === game.id ? "is-on" : ""}`}
              >
                {game.label}
              </button>
            ))}
          </div>
        </div>

        <p className={`game-hint ${mismatch ? "is-warning" : ""}`} role="status">
          {state.detected === null
            ? "無法從檔名辨識片別，請確認後再套用。"
            : mismatch
              ? `檔名像是《${GAMES.find((game) => game.id === state.detected)?.label}》，但你選了《${current.label}》。位址會隨片別不同，套錯版本可能沒效果甚至讓遊戲出錯。`
              : `已依檔名辨識為《${current.label}》（PS 日版 ${current.serial}）。`}
        </p>

        <p className="sheet-lead">
          以下為 PlayStation <strong>日版</strong>《{current.label}》的 GameShark 金手指，開啟後由模擬器直接修改遊戲記憶體。
          {state.game === "x4" ? (
            <>
              <strong>建議在開始新遊戲前啟用第四裝甲</strong>，也可以先選好集氣彈種類。
            </>
          ) : (
            <>開啟後即可在遊戲中直接切換裝甲。</>
          )}
        </p>

        <div className={`patch-preset ${falconOn ? "is-on" : ""}`}>
          <div className="patch-preset-copy">
            <strong>{state.game === "x5" ? "獵鷹完全體組合（X5）" : "跨代獵鷹外型能力組合（X4）"}</strong>
            <small>
              {state.game === "x5"
                ? "一鍵開啟：穿上獵鷹裝甲（外型＋能力）+ 開放全裝甲 + 無限飛行 + 取消硬直連射 + X 彈瞬滿（自動避開覆蓋飛行的空中限制碼）"
                : `一鍵開啟：全套裝甲＋自由飛行（無限空行動＋無限漂浮）＋ X 彈瞬滿，外型目前為「${
                    X4_OUTFITS.find((option) => option.id === state.x4Outfit)?.label ?? "第四裝甲"
                  }」。額外寫入分能力（突進、速度、連射）與外型（殘影）兩類，套組預勾除「空中移動衝刺速度」外的四項；刻意不含 △ 瞬滿，因為獵鷹裝甲無法集氣特殊武器。外型與額外寫入都可在下方卡片逐項調整。`}
            </small>
          </div>
          <button
            type="button"
            className={`patch-preset-btn ${falconOn ? "is-on" : ""}`}
            onClick={toggleFalconPreset}
            aria-pressed={falconOn}
          >
            {falconOn ? "✓ 已套用" : "一鍵開啟"}
          </button>
        </div>

        {state.game === "x5" && (
          <div className={`patch-preset ${gaiaOn ? "is-on" : ""}`}>
            <div className="patch-preset-copy">
              <strong>蓋亞重裝組合（X5）</strong>
              <small>
                一鍵開啟：穿上蓋亞裝甲（外型＋能力）+ 開放全裝甲 + X 彈瞬滿；受傷減半、尖刺即死無效、貼牆不下滑。
                會自動關閉獵鷹外型與飛行系補丁，因為蓋亞沒有空中衝刺、移動較慢，也不能使用特殊武器。
              </small>
            </div>
            <button
              type="button"
              className={`patch-preset-btn ${gaiaOn ? "is-on" : ""}`}
              onClick={toggleGaiaPreset}
              aria-pressed={gaiaOn}
            >
              {gaiaOn ? "✓ 已套用" : "一鍵開啟"}
            </button>
          </div>
        )}

        {activeCount > 0 && (
          <div className="patch-summary" role="status">
            <span className="patch-summary-dot" />
            已啟用 {activeCount} 項
            {!nowApplied && <span className="patch-summary-pending">（模擬器啟動後套用）</span>}
          </div>
        )}

        <div className="cheat-list">
          {patchesFor(state.game).map((p) => (
            <PatchCard
              key={p.id}
              patch={resolvePatch(p, state.chargeShot)}
              on={state.enabled.includes(p.id)}
              applied={nowApplied && state.applied}
              onToggle={(v) => toggle(p.id, v)}
            >
              {p.id === "buster-type" && (
                <ChargeShotPicker
                  state={{
                    chargeShot: state.chargeShot,
                    chargeShotMode: state.chargeShotMode,
                    squareShot: state.squareShot,
                    triangleShot: state.triangleShot,
                    liveShot: state.liveShot,
                  }}
                  applied={nowApplied && state.applied}
                  onSelect={selectChargeShot}
                  onMode={selectMode}
                  onAssign={assignButtonShot}
                />
              )}
              {p.id === "x5-falcon-equip" && <FalconLook />}
              {p.id === X4_FALCON_PATCH_ID && (
                <>
                  <OutfitPicker value={state.x4Outfit} applied={nowApplied && state.applied} onSelect={selectOutfit} />
                  <ExtraWritesPicker
                    enabled={state.x4Extras}
                    applied={nowApplied && state.applied}
                    outfit={state.x4Outfit}
                    onToggle={toggleExtra}
                    onSetAll={setAllExtras}
                  />
                </>
              )}
            </PatchCard>
          ))}
        </div>

        <div className="sheet-note">
          <strong>資料來源與注意事項：</strong>
          {state.game === "x4" ? (
            <>
              裝甲及輔助碼參考 PTT 洛克人板；手部彈種參考 PS 日版改造碼資料，僅適用於 <strong>PS 日版</strong>
              《洛克人X4》（SLPS-00902）的 X。究極裝甲在原作中固定使用電漿彈，此選擇器用於第四裝甲。
              「跨代:獵鷹外型能力」是組合碼，把 <code>30141A4F</code>（全套裝甲）、<code>30141A2E</code>
              （空中行動不限）與 <code>30141A7D</code>（無限漂浮）寫在一起，用 X4 位址重現 X5 獵鷹裝甲的自由飛行；
              外型選「究極裝甲」時再加上 <code>301722AF</code>（隱藏要素旗標，等同角色選擇畫面的隱藏指令）。
              「額外寫入」五項同樣出自 PTT 洛克人板的 X4 清單，分「能力」四項（<code>30141A2D</code> 衝刺距離、
              <code>30141A2C</code> 空中速度、<code>30141A3A</code> 硬直取消、<code>30141A40</code> 連射限制）與「外型」一項
              （<code>30141A34</code> 殘影），勾選後會接在同一組碼後面，不另佔金手指槽位。
              射擊類兩項建議搭配電漿炮彈種以獲得穿透效果；套組刻意不含 △ 瞬滿，因為獵鷹裝甲無法集氣特殊武器。
              獵鷹另一項重現不了的是「防禦減半」：公開的 X4 改造資料沒有對應的傷害位址，本站不提供未經證實的碼。
              X4 本身沒有獵鷹裝甲的圖像資料，因此外型只能在第四／究極之間選擇。以 SLPS-00902 執行檔做靜態掃描（追蹤基底指標的讀寫）：裝甲、集氣與額外寫入的位址都有遊戲程式的讀寫指令；空中限制（<code>30141A2E</code>）與無限漂浮（<code>30141A7D</code>）掃描追蹤不到，可能經由指標間接存取，依社群回報保留。
              <br />
              「瞬間集滿」兩項分別對應 <code>30141A43</code>（□）與 <code>30141A44</code>（△）
              ，工具列的「雙開」會一併開啟，讓 □ 與 △ 都不必等集氣時間。△ 要有手部裝甲並選好特殊武器才會集氣。
            </>
          ) : (
            <>
              全裝甲與獵鷹飛行／射擊強化碼參考 PS 日版《洛克人X5》（SLPM-86666）改造碼清單（<code>300D3122/300D3179</code>、
              <code>3009B668</code> 無限飛行、<code>3009B612/3009B618</code> 取消硬直連射、<code>3009B61C/3009B61B</code> 瞬滿集氣）。
              「獵鷹外型能力」與「蓋亞外型能力」取自日版 PAR「アーマー選択」：<code>300D3121</code>（存檔的裝甲選擇，關卡載入時據此讀入圖像）與
              <code>3009B67A</code>（關卡內的裝甲位元組）同寫裝甲值；0 無裝甲、1 第四、2 獵鷹、3 蓋亞、4 究極。
              兩者寫的是同一個位址，因此最後開啟的一種為準，面板會自動關閉另一種。
              開局碼會一併開放黑傑洛旗標；獵鷹裝甲無法集氣特殊武器且防禦減半，蓋亞則是移動較慢、沒有空中衝刺且不能使用特殊武器，但受傷減半並免疫尖刺即死。若同時開啟 <code>3009B606</code> 會改走兩段跳而失去第四／獵鷹原本的飛行能力。以 SLPM-86666 執行檔做靜態掃描：裝甲、射擊與裝甲選擇位址都有遊戲程式的讀寫指令；無限飛行（<code>3009B668</code>）與空中限制（<code>3009B606</code>）掃描追蹤不到，依社群回報保留。
            </>
          )}
          其他版本可能無效或讓遊戲出錯，建議先快速存檔。
        </div>

        <button type="button" className="sheet-next" onClick={onShowCodes}>
          <span>
            <strong>不想改記憶體？</strong>
            <small>「隱藏指令」可用遊戲內建的隱藏指令取得究極裝甲與黑傑洛</small>
          </span>
          <span aria-hidden>›</span>
        </button>
      </section>
    </>
  );
}
