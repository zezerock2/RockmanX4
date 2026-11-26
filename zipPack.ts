/**
 * 光碟映像的 ZIP 打包與檔名修正。
 *
 * .cue 用 FILE 行指向資料檔（.bin），而模擬器核心是「逐位元組」比對這個檔名。
 * 實際的光碟包常見兩種對不上的情況：
 *   - X5 壓縮包：cue 以 Big5 寫檔名，條目名稱則是 UTF-8。
 *   - X4 光碟包：cue 寫 "[SLPS-00902]"，實際的 bin 卻叫 "(Japan)"。
 * 因此統一把資料檔改名為 game.bin（多軌為 game-1.bin…），並改寫 cue 的 FILE 行。
 *
 * - packFiles：多選檔案，條目以 stored 方式寫入，串流計算 CRC32。
 * - prepareZip：單一壓縮檔，只讀中央目錄與 cue；資料檔以「原始壓縮位元組」直接搬移，
 *   不解壓、不重新壓縮，因此 583 MB 的映像幾乎不占額外記憶體。
 */

export type PackedEntry = { original: string; stored: string };
export type PackResult = { blob: Blob; name: string; entries: PackedEntry[]; missing: string[] };
export type ZipPrep = { blob: Blob; name: string; repacked: boolean };

const encoder = new TextEncoder();
const CUE_RE = /\.cue$/i;
const DATA_EXT = new Set([".bin", ".img", ".iso", ".mdf", ".raw", ".sub", ".wav"]);
const FILE_RE = /FILE\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+BINARY/gi;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return c;
}

/** 串流計算一整個 Blob 的 CRC32；onChunk 每讀一段回報位元組數。 */
async function crc32Of(blob: Blob, onChunk?: (bytes: number) => void): Promise<number> {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (value && value.length) {
      crc = crc32Update(crc, value);
      onChunk?.(value.length);
    }
    if (done) break;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 解碼 cue 或檔名：依序嚴格嘗試 UTF-8、Big5、Shift_JIS、CP1252，都失敗才放寬。 */
function decodeText(bytes: Uint8Array): string {
  for (const encoding of ["utf-8", "big5", "shift_jis", "windows-1252"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      /* 換下一個編碼 */
    }
  }
  return new TextDecoder().decode(bytes);
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const stemOf = (path: string) => baseName(path).replace(/\.[^.]+$/, "");
const extOf = (path: string) => {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
};

function dosStamp(timestamp: number) {
  const d = new Date(timestamp || Date.now());
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

/* ------------------------------------------------------------------ */
/*  配對與改名（打包與修正共用）                                         */
/* ------------------------------------------------------------------ */

export type CuePlan = { text: string; storedNames: string[]; missing: string[] };

/**
 * 決定每個資料檔的新名稱，並改寫 cue 的 FILE 行。
 * 配對順序：(1) 檔名（忽略大小寫）完全相同；(2) 剩下的參照與剩下的檔案數量相同時，
 * 依序配對——專門處理「檔名被改過」的情況。配不到的參照列在 missing，原樣保留在 cue 內。
 */
export function planCue(cueText: string, candidates: readonly { name: string }[]): CuePlan {
  const refs: string[] = [];
  for (const match of cueText.matchAll(FILE_RE)) refs.push(String(match[1] ?? match[2] ?? match[3]));

  const pairedWith = new Map<number, number>(); // 參照序號 -> 檔案序號
  const taken = new Set<number>();
  refs.forEach((ref, r) => {
    const i = candidates.findIndex(
      (c, idx) => !taken.has(idx) && baseName(c.name).toLowerCase() === baseName(ref).toLowerCase(),
    );
    if (i >= 0) {
      pairedWith.set(r, i);
      taken.add(i);
    }
  });
  const freeRefs = refs.map((_, r) => r).filter((r) => !pairedWith.has(r));
  const freeCands = candidates.map((_, i) => i).filter((i) => !taken.has(i));
  if (freeRefs.length && freeRefs.length === freeCands.length) {
    freeRefs.forEach((r, k) => {
      pairedWith.set(r, freeCands[k]);
      taken.add(freeCands[k]);
    });
  }
  const missing = refs.filter((_, r) => !pairedWith.has(r));

  const single = refs.length === 1;
  const storedNames: (string | undefined)[] = candidates.map(() => undefined);
  refs.forEach((_, r) => {
    const i = pairedWith.get(r);
    if (i === undefined || storedNames[i] !== undefined) return;
    const ext = extOf(candidates[i].name) || ".bin";
    storedNames[i] = single ? `game${ext}` : `game-${r + 1}${ext}`;
  });
  let extra = 0;
  candidates.forEach((c, i) => {
    if (storedNames[i] !== undefined) return;
    extra += 1;
    storedNames[i] = `extra-${extra}${extOf(c.name) || ".bin"}`;
  });

  let k = 0;
  const text = cueText.replace(FILE_RE, (whole) => {
    const i = pairedWith.get(k++);
    return i === undefined ? whole : `FILE "${storedNames[i]}" BINARY`;
  });
  return { text, storedNames: storedNames as string[], missing };
}

/* ------------------------------------------------------------------ */
/*  ZIP 寫入器                                                         */
/* ------------------------------------------------------------------ */

type Source = {
  stored: string;
  /** 寫入壓縮檔的位元組；method 8 時已是壓縮後的資料 */
  data: Blob;
  method: 0 | 8;
  crc: number;
  usize: number;
  time: number;
  date: number;
};

function header(central: boolean, name: Uint8Array, s: Source, offset: number): Uint8Array {
  const buf = new Uint8Array((central ? 46 : 30) + name.length);
  const v = new DataView(buf.buffer);
  const at = (local: number, cen: number) => (central ? cen : local);
  v.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
  v.setUint16(4, 20, true); // 版本（本地標頭為需求版本；中央目錄為建立版本）
  if (central) v.setUint16(6, 20, true);
  v.setUint16(at(6, 8), 0x0800, true); // 旗標：檔名為 UTF-8
  v.setUint16(at(8, 10), s.method, true);
  v.setUint16(at(10, 12), s.time, true);
  v.setUint16(at(12, 14), s.date, true);
  v.setUint32(at(14, 16), s.crc, true);
  v.setUint32(at(18, 20), s.data.size, true);
  v.setUint32(at(22, 24), s.usize, true);
  v.setUint16(at(26, 28), name.length, true);
  if (central) v.setUint32(42, offset, true);
  buf.set(name, central ? 46 : 30);
  return buf;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const buf = new Uint8Array(22);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  return buf;
}

/** 組出 ZIP。資料以 Blob 片段參照，不會在記憶體中複製光碟內容。 */
function buildZip(sources: readonly Source[]): Blob {
  if (sources.length > 0xfffe) throw new Error("檔案數量超過 ZIP 上限");
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const s of sources) {
    const name = encoder.encode(s.stored);
    const local = header(false, name, s, 0);
    parts.push(new Uint8Array(local), s.data);
    central.push(header(true, name, s, offset));
    offset += local.length + s.data.size;
  }
  if (offset > 0xffffffff) throw new Error("超過 4 GB，無法以標準 ZIP 格式打包");
  let cdSize = 0;
  for (const c of central) {
    parts.push(new Uint8Array(c));
    cdSize += c.length;
  }
  parts.push(new Uint8Array(endRecord(sources.length, cdSize, offset)));
  return new Blob(parts, { type: "application/zip" });
}

async function storedSource(data: Blob, stored: string, lastModified: number): Promise<Source> {
  const { time, date } = dosStamp(lastModified);
  return { stored, data, method: 0, crc: await crc32Of(data), usize: data.size, time, date };
}

/* ------------------------------------------------------------------ */
/*  多選檔案打包                                                       */
/* ------------------------------------------------------------------ */

/**
 * 多選檔案（cue + bin …）打包成 ZIP。回傳的 Blob 可直接交給 EmulatorJS。
 * @param onProgress 進度回報（已讀位元組 / 總位元組），由呼叫端自行節流。
 */
export async function packFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<PackResult> {
  if (!files.length) throw new Error("沒有選取任何檔案");
  const cue = files.find((file) => CUE_RE.test(file.name)) ?? null;
  const others = files.filter((file) => file !== cue);
  const entries: PackedEntry[] = [];
  const planned: { file: File; stored: string }[] = [];
  let cueText: string | null = null;
  let missing: string[] = [];

  if (cue) {
    const plan = planCue(decodeText(new Uint8Array(await cue.arrayBuffer())), others);
    cueText = plan.text;
    missing = plan.missing;
    entries.push({ original: cue.name, stored: "game.cue" });
    others.forEach((file, i) => planned.push({ file, stored: plan.storedNames[i] }));
  } else {
    others.forEach((file, i) =>
      planned.push({
        file,
        stored: i === 0 ? `game${extOf(file.name) || ".bin"}` : `extra-${i}${extOf(file.name) || ".bin"}`,
      }),
    );
  }
  for (const p of planned) entries.push({ original: p.file.name, stored: p.stored });

  const sources: Source[] = [];
  if (cue && cueText !== null) {
    sources.push(await storedSource(new Blob([encoder.encode(cueText)]), "game.cue", cue.lastModified));
  }
  const total = planned.reduce((sum, p) => sum + p.file.size, 0);
  let done = 0;
  for (const p of planned) {
    const crc = await crc32Of(p.file, (bytes) => {
      done += bytes;
      onProgress?.(done, total);
    });
    const { time, date } = dosStamp(p.file.lastModified);
    sources.push({ stored: p.stored, data: p.file, method: 0, crc, usize: p.file.size, time, date });
  }
  onProgress?.(total, total);

  return { blob: buildZip(sources), name: stemOf((cue ?? others[0]).name), entries, missing };
}

/* ------------------------------------------------------------------ */
/*  單一壓縮檔修正                                                     */
/* ------------------------------------------------------------------ */

type ZipEntry = {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  dataStart: number;
  time: number;
  date: number;
  dir: boolean;
};

async function dataStartOf(file: Blob, localOffset: number): Promise<number> {
  const local = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
  if (local.getUint32(0, true) !== 0x04034b50) throw new Error("ZIP 本地標頭損毀");
  return localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
}

/** 只讀中央目錄（檔案尾端的一小段），不讀取資料本體。 */
async function readDirectory(file: Blob): Promise<ZipEntry[]> {
  const tailLength = Math.min(file.size, 22 + 0xffff);
  const tail = new DataView(await file.slice(file.size - tailLength).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 檔");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 格式目前不支援");

  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP 中央目錄損毀");
    const flags = cd.getUint16(p + 8, true);
    const nameLength = cd.getUint16(p + 28, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength);
    const name = flags & 0x800 ? new TextDecoder("utf-8").decode(nameBytes) : decodeText(nameBytes);
    out.push({
      name,
      method: cd.getUint16(p + 10, true),
      crc: cd.getUint32(p + 16, true),
      csize: cd.getUint32(p + 20, true),
      usize: cd.getUint32(p + 24, true),
      dataStart: await dataStartOf(file, cd.getUint32(p + 42, true)),
      time: cd.getUint16(p + 12, true),
      date: cd.getUint16(p + 14, true),
      dir: name.endsWith("/"),
    });
    p += 46 + nameLength + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }
  return out;
}

/** 只解壓 cue（很小）。 */
async function inflate(file: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const raw = file.slice(entry.dataStart, entry.dataStart + entry.csize);
  if (entry.method === 0) return new Uint8Array(await raw.arrayBuffer());
  if (entry.method !== 8) throw new Error(`不支援的 ZIP 壓縮方式（${entry.method}）`);
  const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 在位元組陣列中找出 needle 是否出現（cue 很小，線性搜尋即可）。 */
function containsBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  const last = hay.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let j = 0;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return false;
}

/**
 * 單一壓縮檔：若內含 .cue，且其中的檔名與條目名稱（UTF-8 位元組）對不上，
 * 就重新組出一包檔名一致的 ZIP；否則原樣回傳（不做任何複製）。
 * 資料檔以原始壓縮位元組搬移，不解壓、不重新壓縮。
 */
export async function prepareZip(file: File): Promise<ZipPrep> {
  const original: ZipPrep = { blob: file, name: stemOf(file.name), repacked: false };
  const entries = await readDirectory(file);
  const cue = entries.find((e) => !e.dir && CUE_RE.test(e.name));
  if (!cue) return original;

  const cueBytes = await inflate(file, cue);
  const data = entries.filter((e) => !e.dir && e !== cue && DATA_EXT.has(extOf(e.name).toLowerCase()));
  if (!data.length) return original;
  // 模擬器比對的是位元組：cue 內必須含有條目名稱的 UTF-8 位元組，否則就需要修正
  if (data.every((e) => containsBytes(cueBytes, encoder.encode(e.name)))) return original;

  const plan = planCue(decodeText(cueBytes), data.map((e) => ({ name: e.name })));
  if (plan.missing.length) {
    throw new Error(`光碟描述檔指向的檔案不在壓縮檔內：${plan.missing.join("、")}`);
  }

  const raw = (e: ZipEntry, stored: string): Source => {
    if (e.method !== 0 && e.method !== 8) throw new Error(`不支援的 ZIP 壓縮方式（${e.method}）`);
    return {
      stored,
      data: file.slice(e.dataStart, e.dataStart + e.csize),
      method: e.method === 8 ? 8 : 0,
      crc: e.crc,
      usize: e.usize,
      time: e.time,
      date: e.date,
    };
  };

  const cueOut = encoder.encode(plan.text);
  const cueData = new Blob([cueOut]);
  const sources: Source[] = [
    {
      stored: "game.cue",
      data: cueData,
      method: 0,
      crc: await crc32Of(cueData),
      usize: cueOut.length,
      time: cue.time,
      date: cue.date,
    },
  ];
  data.forEach((e, i) => sources.push(raw(e, plan.storedNames[i])));
  for (const e of entries) {
    if (e.dir || e === cue || data.includes(e)) continue;
    sources.push(raw(e, e.name)); // 說明檔等其他條目原樣保留
  }
  return { blob: buildZip(sources), name: stemOf(file.name), repacked: true };
}
