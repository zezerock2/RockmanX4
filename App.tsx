import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Player from "./components/Player";
import { packFiles, prepareZip } from "./lib/zipPack";
import { applyX4PaletteSkin } from "./lib/discPatch";
import type { X4PaletteSkin } from "./lib/discPatch";
import heroDisc from "./assets/hero-disc.jpg";
import textureIri from "./assets/texture-iri.jpg";

const ACCEPT = ".bin,.cue,.iso,.img,.chd,.pbp,.zip,.7z,.m3u";
const PACK_ACCEPT = ".zip,.bin,.cue,.img,.iso,.chd";

type Game = { url: string; name: string };
type Notice = { tone: "warn" | "ok"; text: string };
type Packing = { done: number; total: number; count: number; mode: "pack" | "fix" | "paint" };

const PAINT_KEY = "ps1web.falconPaint";
const SKIN_KEY = "ps1web.x4PaletteSkin";
type PaintSkin = X4PaletteSkin | "off";
const SKIN_LABEL: Record<PaintSkin, string> = { off: "不改色", falcon: "獵鷹", gaia: "蓋亞" };
const readPaintSkin = (): PaintSkin => {
  try {
    const value = localStorage.getItem(SKIN_KEY);
    if (value === "falcon" || value === "gaia" || value === "off") return value;
    return localStorage.getItem(PAINT_KEY) === "1" ? "falcon" : "off";
  } catch {
    return "off";
  }
};

type Entry = { file: string; size: string; use: string; status: string; tone: "ok" | "warn" | "mute" };

/** 清單由壓縮檔目錄實際解析而來 */
const ARCHIVE = { name: "洛克人_X5.zip", bytes: "359,399,797 B", format: "ZIP · Deflate" };

const MANIFEST: Entry[] = [
  {
    file: "洛克人_X5.bin",
    size: "583,660,560 B",
    use: "遊戲光碟映像 · MODE2/2352 · 解壓後 556.7 MiB",
    status: "可直接載入",
    tone: "ok",
  },
  {
    file: "洛克人_X5.cue",
    size: "75 B",
    use: "軌道索引,內部檔名以 Big5 編碼,與 .bin 對不上",
    status: "開機前自動改寫",
    tone: "ok",
  },
];

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: (
      <>
        <rect x="2.5" y="7" width="19" height="10" rx="5" />
        <path d="M7 10.5v3M5.5 12h3" />
        <circle cx="16" cy="11" r="0.6" fill="currentColor" />
        <circle cx="18" cy="13" r="0.6" fill="currentColor" />
      </>
    ),
    title: "觸控按鍵不擋畫面",
    text: "直向時按鍵在畫面下方，橫向時在左右兩側，完全不覆蓋遊戲",
  },
  {
    icon: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11.5H12z" />,
    title: "自動集氣",
    text: "系統一直幫你按住發射鍵，按一下就射出集氣炮；可單開，或「雙開」讓 □ 與 △ 同時集氣",
  },
  {
    icon: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <path d="M6.5 10h.01M10.5 10h.01M14.5 10h.01M17.5 10h.01M7 14h10" />
      </>
    ),
    title: "手把／鍵盤",
    text: "可接 USB／藍牙手把，或用鍵盤遊玩；觸控按鍵可隨時開關",
  },
  {
    icon: (
      <>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M8 4v5h7V4M8 20v-6h8v6" />
      </>
    ),
    title: "快速存讀檔",
    text: "工具列一鍵存檔、讀檔；bin+cue 多檔建議壓成 .zip 或轉成 .chd",
  },
];

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300";
const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-blue-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

const BADGE: Record<Entry["tone"], string> = {
  ok: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  mute: "border-slate-600 bg-slate-700/30 text-slate-400",
};

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

/** 會轉動的彩虹光碟：本頁的識別圖形 */
function DiscMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <defs>
        <linearGradient id="iriGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="30%" stopColor="#818cf8" />
          <stop offset="55%" stopColor="#e879f9" />
          <stop offset="78%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <radialGradient id="glossGrad" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="url(#iriGrad)" />
      <circle cx="100" cy="100" r="96" fill="#05060a" opacity="0.28" />
      <g fill="none" stroke="#05060a" strokeOpacity="0.3">
        <circle cx="100" cy="100" r="88" />
        <circle cx="100" cy="100" r="80" />
        <circle cx="100" cy="100" r="72" />
        <circle cx="100" cy="100" r="64" />
        <circle cx="100" cy="100" r="56" />
      </g>
      <g fill="#05060a" fillOpacity="0.5">
        <rect x="97" y="44" width="6" height="18" rx="2" />
        <rect x="97" y="44" width="6" height="18" rx="2" transform="rotate(120 100 100)" />
        <rect x="97" y="44" width="6" height="18" rx="2" transform="rotate(240 100 100)" />
      </g>
      <circle cx="100" cy="100" r="34" fill="#0b0f16" />
      <circle cx="100" cy="100" r="34" fill="none" stroke="#ffffff" strokeOpacity="0.16" />
      <circle cx="100" cy="100" r="13" fill="#05060a" />
      <circle cx="100" cy="100" r="96" fill="url(#glossGrad)" />
      <circle cx="100" cy="100" r="96" fill="none" stroke="#ffffff" strokeOpacity="0.28" />
    </svg>
  );
}

export default function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [dragging, setDragging] = useState(false);
  const [packing, setPacking] = useState<Packing | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const gameRef = useRef<HTMLInputElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const lastPct = useRef(-1);
  const [paintSkin, setPaintSkin] = useState<PaintSkin>(readPaintSkin);
  const paint = paintSkin !== "off";

  const selectPaintSkin = (skin: PaintSkin) => {
    setPaintSkin(skin);
    try {
      localStorage.setItem(SKIN_KEY, skin);
      localStorage.setItem(PAINT_KEY, skin === "falcon" ? "1" : "0");
    } catch {
      /* 無法儲存時，這次的選擇仍然有效 */
    }
  };

  /**
   * 裝甲配色：把選取檔案中的 .bin 換成改色後的副本（以 Blob 切片銜接，原檔不變）。
   * 回傳 null 代表不能繼續，提示已經顯示。
   */
  const paintSelection = async (files: File[]): Promise<File[] | null> => {
    if (paintSkin === "off") return files;
    const bin = files.find((file) => /\.bin$/i.test(file.name));
    if (!bin) {
      setNotice({
        tone: "warn",
        text: `裝甲配色需要未壓縮的 .bin（可和 .cue 一起複選）。.zip／.chd 無法在瀏覽器內直接改寫，請先解壓，或改選「不改色」。`,
      });
      return null;
    }
    setPacking({ done: 0, total: 1, count: 1, mode: "paint" });
    try {
      const result = await applyX4PaletteSkin(bin, paintSkin);
      return files.map((file) =>
        file === bin ? new File([result.blob], bin.name, { lastModified: bin.lastModified }) : file,
      );
    } catch (error) {
      setNotice({ tone: "warn", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setPacking(null);
    }
  };

  // 提示停留一會兒後自行淡出，但仍可手動關閉
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(id);
  }, [notice]);

  /** 單一壓縮檔：若 cue 與資料檔的檔名對不上，只改寫 cue 並重組；否則原樣交給模擬器。 */
  const openZip = async (file: File) => {
    setPacking({ done: 0, total: 1, count: 1, mode: "fix" });
    try {
      const prep = await prepareZip(file);
      setGame({ url: URL.createObjectURL(prep.blob), name: prep.name });
    } catch (error) {
      setNotice({
        tone: "warn",
        text: `無法讀取這個壓縮檔：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setPacking(null);
    }
  };

  const start = async (input: FileList | File[]) => {
    let files = Array.from(input);
    if (!files.length || game || packing) return;

    if (paint) {
      const painted = await paintSelection(files);
      if (!painted) return;
      files = painted;
    }

    // 單檔:直接交給模擬器(整包 .zip 由 EmulatorJS 自行解壓)
    if (files.length === 1) {
      const file = files[0];
      if (/\.cue$/i.test(file.name)) {
        setNotice({
          tone: "warn",
          text: "只選到 .cue,它引用的 .bin 沒有一併進來。請按住 Ctrl / ⌘ 複選兩個檔案,或改丟整包 .zip。",
        });
        return;
      }
      if (/\.rar$/i.test(file.name)) {
        setNotice({
          tone: "warn",
          text: "瀏覽器無法解開 RAR。請先用 7-Zip / WinRAR 解壓，再同時選取 .cue 與 .bin（或重新壓成 .zip）。",
        });
        return;
      }
      if (/\.zip$/i.test(file.name)) {
        await openZip(file);
        return;
      }
      setGame({ url: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, "") });
      return;
    }

    // 多檔但夾帶壓縮檔:直接用壓縮檔,避免把 zip 再包一層
    const archive = files.find((file) => /\.(zip|7z)$/i.test(file.name));
    if (archive) {
      setNotice({ tone: "ok", text: `同時選到 ${files.length} 個檔案,已改用其中的壓縮檔 ${archive.name}。` });
      if (/\.zip$/i.test(archive.name)) {
        await openZip(archive);
        return;
      }
      setGame({ url: URL.createObjectURL(archive), name: archive.name.replace(/\.[^.]+$/, "") });
      return;
    }

    // 雙檔案讀取:打包成 ZIP,並把 cue 的 FILE 檔名改成與條目一致
    lastPct.current = -1;
    setPacking({ done: 0, total: files.reduce((sum, file) => sum + file.size, 0), count: files.length, mode: "pack" });
    try {
      const result = await packFiles(files, (done, total) => {
        const pct = total ? Math.round((done / total) * 100) : 100;
        if (pct === lastPct.current) return;
        lastPct.current = pct;
        setPacking({ done, total, count: files.length, mode: "pack" });
      });
      setGame({ url: URL.createObjectURL(result.blob), name: result.name });
    } catch (error) {
      setNotice({
        tone: "warn",
        text: `打包失敗:${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setPacking(null);
    }
  };

  if (game) return <Player url={game.url} name={game.name} />;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void start(e.dataTransfer.files);
  };

  const pct = packing && packing.total ? Math.min(100, Math.round((packing.done / packing.total) * 100)) : 0;

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-100">
      <header className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500 font-black shadow-lg shadow-blue-500/30">
          X
        </div>
        <div>
          <h1 className="text-lg font-bold">PS1 網頁模擬器</h1>
          <p className="text-xs text-slate-400">在瀏覽器內執行您自己擁有的遊戲備份</p>
        </div>
        <span className="ml-auto hidden font-mono text-[11px] uppercase tracking-[0.25em] text-slate-500 sm:block">
          local only
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16">
        {/* ── 標題 ─────────────────────────────── */}
        <section className="mt-6">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-blue-300/90">
            <span className="h-px w-10 bg-gradient-to-r from-sky-400 to-fuchsia-400" />
            local disc image · 本機讀取
          </div>
          <h2 className="mt-4 text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            拖進來，
            <br />
            <span className="bg-gradient-to-r from-sky-300 via-indigo-200 to-amber-200 bg-clip-text text-transparent">
              就開機。
            </span>
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            載入 .bin / .cue / .chd / .pbp 等光碟映像，也可以直接丟 .zip，或一次多選 .cue 與 .bin；
            搭配自動集氣、觸控與手把操作。
          </p>
        </section>

        {/* ── 載入區 ───────────────────────────── */}
        <section className="mt-8 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!packing) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={(e) => {
                // 隱藏 input 的合成 click 會冒泡回來，避免遞迴觸發選擇器
                if (packing || e.target instanceof HTMLInputElement) return;
                gameRef.current?.click();
              }}
              onKeyDown={(e) => {
                if (packing) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  gameRef.current?.click();
                }
              }}
              role="button"
              tabIndex={packing ? -1 : 0}
              aria-busy={!!packing}
              aria-label="選擇光碟映像檔，可多選"
              className={`flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition sm:p-10 ${
                packing
                  ? "border-blue-500/60 bg-blue-500/[0.07]"
                  : dragging
                    ? "border-blue-400 bg-blue-500/10"
                    : "border-slate-700 bg-slate-900/50 hover:border-blue-500"
              }`}
            >
              {packing ? (
                <>
                  <svg viewBox="0 0 24 24" className="mb-4 h-12 w-12 animate-pulse text-blue-300" {...stroke} aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="2.5" />
                    <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="3" />
                  </svg>
                  <h3 className="text-lg font-bold sm:text-xl">
                    {packing.mode === "paint"
                      ? `正在寫入${SKIN_LABEL[paintSkin]}配色`
                      : packing.mode === "fix"
                        ? "正在修正光碟檔名"
                        : `正在打包 ${packing.count} 個檔案`}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    {packing.mode === "paint"
                      ? "只改寫調色盤所在的兩個扇區並重算校驗碼，其餘光碟資料原樣銜接，原檔不會被修改"
                      : packing.mode === "fix"
                        ? "只改寫 cue 內的檔名，光碟資料原樣搬移，不解壓、不重新壓縮"
                        : "串流計算校驗碼並組成 ZIP，光碟資料不複製、不上傳"}
                  </p>
                  <div
                    className="mt-5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-700"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500 transition-[width] duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-xs tabular-nums text-slate-400">
                    {pct}%{packing.mode === "pack" ? ` · ${mb(packing.done)} / ${mb(packing.total)} MB` : ""}
                  </p>
                  <input
                    ref={gameRef}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && start(e.target.files)}
                  />
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="mb-4 h-12 w-12 text-blue-300" {...stroke} aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="2.5" />
                    <path d="M12 3a9 9 0 0 1 9 9" strokeWidth="3" />
                  </svg>
                  <h3 className="text-lg font-bold sm:text-xl">拖放或點擊選擇光碟映像檔</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    支援 .bin / .iso / .chd / .pbp / .zip / .7z，可複選 .cue + .bin
                  </p>
                  <p className="mt-1 text-xs text-slate-500">檔案只在您的瀏覽器本機讀取，不會上傳到任何伺服器</p>
                  <input
                    ref={gameRef}
                    type="file"
                    multiple
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && start(e.target.files)}
                  />
                </>
              )}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              多選時（Windows 按住 Ctrl、macOS 按住 ⌘）可同時選 .cue 與 .bin，網站會自動打包並把 cue
              內的檔名改成一致；只選到 .cue 會提示補選 .bin。
            </p>

            <fieldset
              className={`mt-3 rounded-2xl border px-4 py-3 transition ${
                paint ? "border-sky-400/60 bg-sky-400/10" : "border-slate-800 bg-slate-900/60"
              }`}
            >
              <legend className="sr-only">X4 裝甲配色</legend>
              <span className="block text-sm font-semibold text-slate-100">
                X4 裝甲配色
                <span className="ml-2 rounded-full border border-sky-400/40 px-2 py-0.5 align-middle font-mono text-[10px] font-medium tracking-wide text-sky-300">
                  只改顏色
                </span>
              </span>
              <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="X4 裝甲配色">
                {(
                  [
                    ["off", "不改色", "使用原版藍色"],
                    ["falcon", "獵鷹配色", "深寶藍與銀白"],
                    ["gaia", "蓋亞配色", "黑鐵、槍灰與銀白"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition ${
                      paintSkin === value
                        ? "border-sky-300 bg-sky-400/15"
                        : "border-slate-700 bg-slate-900/50 hover:border-sky-500/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="x4-palette-skin"
                      value={value}
                      checked={paintSkin === value}
                      disabled={!!packing}
                      onChange={() => selectPaintSkin(value)}
                      className="mt-1 h-4 w-4 shrink-0 accent-sky-400"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-slate-100">{label}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <span className="mt-2 block text-xs leading-relaxed text-slate-400">
                載入日版《洛克人X4》的 .bin 時，只改 X 本體調色盤中的藍色；膚色、紅色與青綠色寶石不變。
                <strong className="font-semibold text-slate-300">形狀仍是 X4 原本的 X</strong>
                ，獵鷹與蓋亞的造型無法在 X4 上呈現。只處理未壓縮的 .bin（可和 .cue 複選），可接受原版或已套用另一種配色的映像；原檔不會被修改。
              </span>
            </fieldset>

            {notice && (
              <div
                className={`mt-3 rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                  notice.tone === "warn"
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                    : "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                }`}
                role="status"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest">
                    {notice.tone === "warn" ? "hint" : "ok"}
                  </span>
                  <p className="flex-1">{notice.text}</p>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    aria-label="關閉提示"
                    className="shrink-0 rounded px-1 text-current opacity-60 transition hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 影像欄 */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0d14] lg:col-span-5">
            <img
              src={heroDisc}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover object-right"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#05060a] via-[#05060a]/45 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#05060a] via-transparent to-[#05060a]/40" />
            <DiscMark className="disc-spin absolute -right-7 -top-7 h-32 w-32 opacity-95 drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]" />
            <div className="relative flex h-full min-h-[260px] flex-col justify-end p-5">
              <div className="rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-sm">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-blue-300">
                  emulatorjs · beetle psx
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                  映像直接交給瀏覽器內的 PS1 核心執行，不經過任何伺服器。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 已匯入封裝 ───────────────────────── */}
        <section className="relative mt-10 overflow-hidden rounded-3xl border border-white/10 bg-[#0a0d14]">
          <img
            src={textureIri}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-screen"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#05060a]/75 via-[#05060a]/88 to-[#05060a]" />
          <div className="relative p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-blue-300/90">
                  imported package · 已匯入封裝
                </p>
                <h3 className="mt-2 break-words text-xl font-extrabold sm:text-2xl">{ARCHIVE.name}</h3>
                <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
                  {ARCHIVE.bytes} · {ARCHIVE.format} · {MANIFEST.length} 個檔案
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} onClick={() => packRef.current?.click()}>
                  載入 洛克人_X5.zip
                </button>
                <button type="button" className={btnGhost} onClick={() => gameRef.current?.click()}>
                  選擇映像（可多選）
                </button>
              </div>
            </div>

            <ul className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/45">
              <li className="hidden gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.85fr)]">
                <span>檔案</span>
                <span className="md:text-right">大小</span>
                <span>用途</span>
                <span>狀態</span>
              </li>
              {MANIFEST.map((e) => (
                <li
                  key={e.file}
                  className="grid gap-1.5 border-b border-white/[0.07] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,1.7fr)_minmax(0,0.85fr)] md:items-center md:gap-4"
                >
                  <span className="break-words font-mono text-[13px] text-blue-100">{e.file}</span>
                  <span className="font-mono text-[13px] tabular-nums text-slate-400 md:text-right">
                    {e.size}
                  </span>
                  <span className="text-[13px] leading-snug text-slate-400">{e.use}</span>
                  <span
                    className={`justify-self-start rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${BADGE[e.tone]}`}
                  >
                    {e.status}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-2 text-xs leading-relaxed text-slate-400 sm:grid-cols-2">
              <p>
                <strong className="font-semibold text-slate-300">方式一：</strong>
                直接把 洛克人_X5.zip 拖進上方載入區，網站會先修正壓縮檔內 cue 的檔名（只改寫檔名、不重新壓縮），再交給模擬器開機。
              </p>
              <p>
                <strong className="font-semibold text-slate-300">方式二：</strong>
                已解壓也行：複選 .cue 與 .bin，網站打包時會把 cue 的 Big5 檔名改寫成一致；金手指面板依檔名判斷
                X4/X5，X4 可用「跨代:獵鷹外型能力」。
              </p>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-slate-400">
              清單由壓縮檔目錄解析而來，僅供識別；檔案由您的電腦本機讀取。
              <strong className="font-semibold text-slate-300">本站不提供、也不託管任何遊戲檔案，</strong>
              請只載入您合法擁有的遊戲備份。
            </p>
          </div>
        </section>

        {/* ── 功能 ─────────────────────────────── */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-blue-300" {...stroke} aria-hidden>
                {f.icon}
              </svg>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>

        {/* ── 金手指 ───────────────────────────── */}
        <div className="mt-8 overflow-hidden rounded-2xl border border-blue-900/50 bg-gradient-to-br from-slate-900 to-blue-950/40">
          <div className="border-b border-slate-800 px-5 py-4">
            <h3 className="font-semibold text-slate-100">《洛克人 X4》隱藏指令（日版）</h3>
            <p className="mt-1 text-sm text-slate-400">
              進入遊戲後按「秘技」就能自動輸入，也可以照下面的順序手動按；「金手指」則能讓你開局就穿著第四裝甲。
            </p>
          </div>
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div>
              <div className="text-sm font-semibold text-slate-200">X 究極裝甲</div>
              <p className="mt-2 font-mono text-sm text-blue-300">✕ ✕ ←×6，按住 L1+R2 再按 ○</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                成功後 X 的緊身衣會變紫色；到任一改造膠囊（磁網蜘蛛關最簡單）即可取得全套究極裝甲。
              </p>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-200">Zero 黑裝甲</div>
              <p className="mt-2 font-mono text-sm text-blue-300">按住 R1 按 →×6，放開 R1，按住 ✕ 再按 ○</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">傑洛全身變黑，純粹外觀變化，開始遊戲即可使用。</p>
            </div>
          </div>
          <p className="border-t border-slate-800 px-5 py-3 text-xs leading-relaxed text-slate-500">
            進入「秘技 → 金手指」啟用<strong className="font-semibold text-slate-300">「開局第四裝甲」</strong>
            ，可選擇四連裝集氣彈或電漿集氣彈，選擇會自動記住（僅適用 PS 日版 X4）。獵鷹裝甲是《洛克人X5》的裝甲，X4
            並沒有它的圖像資料；X4 面板的「跨代:獵鷹外型能力」以 X4 位址重現自由飛行，外型可在第四裝甲與究極裝甲（隱藏旗標）之間選擇，
            下方的「額外寫入」再分能力（突進、速度、連射）與外型（殘影軌跡）兩類，可逐項開關。載入 X5
            時面板會切換成原版補丁：「獵鷹外型能力」直接讓 X 穿上獵鷹裝甲，外型與能力一併生效，另有無限飛行與連射強化可一鍵套用。
          </p>
        </div>

        {/* ── 鍵盤 ─────────────────────────────── */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          <h3 className="mb-2 font-semibold text-slate-200">預設鍵盤操作</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <span>方向：方向鍵</span>
            <span>✕ 跳躍：X</span>
            <span>○ 衝刺：Z</span>
            <span>□ 發射：S</span>
            <span>△：A</span>
            <span>L1／R1：Q／E</span>
            <span>L2／R2：Tab／R</span>
            <span>Start／Select：Enter／V</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            請只載入您合法擁有的遊戲備份。本站不提供、也不託管任何遊戲檔案。
          </p>
        </div>

        <input
          ref={packRef}
          type="file"
          accept={PACK_ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && start(e.target.files)}
        />
      </main>
    </div>
  );
}
