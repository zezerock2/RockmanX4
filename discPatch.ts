/**
 * 光碟映像補丁：把「獵鷹／蓋亞配色」寫進日版《洛克人X4》(SLPS-00902) 的 BIN 映像。
 *
 * 做法：X 的調色盤集中在 ARC/PL00.ARC 開頭的一個區塊（2464 位元組，77 組 16 色），
 * 只佔光碟的兩個扇區。這裡只改這兩個扇區：改色後重算 CD-ROM 的 EDC 與 ECC，
 * 其餘部分以 Blob 切片原樣銜接，因此 593 MB 的映像不會被複製進記憶體。
 *
 * 安全檢查：動手前先比對原始調色盤區塊的 CRC32，不是日版 X4 就拒絕，不會誤改其他光碟。
 * 補丁只改顏色，不改形狀；檔案只在瀏覽器本機處理，不會上傳。
 */
import {
  X4_FALCON_CHANGES,
  X4_GAIA_CHANGES,
  X4_GAIA_CRC_PATCHED,
  X4_PALETTE_BYTES,
  X4_PALETTE_CRC_ORIGINAL,
  X4_PALETTE_CRC_PATCHED,
} from "./falconPalette";

const SECTOR = 2352;
const DATA_OFFSET = 24; // 同步 12 + 標頭 4 + 子標頭 8
const DATA_LENGTH = 2048;
const SYNC = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

export type PalettePatchSpec = {
  /** 調色盤區塊所在的第一個扇區（映像檔內的扇區序號 = 光碟 LBA） */
  lba: number;
  /** 調色盤區塊的位元組數 */
  bytes: number;
  crcOriginal: number;
  crcPatched: number;
  /** 除了原始狀態外，也接受這些已知狀態作為起點（例如另一種配色已套用的映像） */
  acceptedCrcs?: readonly number[];
  /** [調色盤序號, 顏色序號, 新的 15 位元 BGR 值] */
  changes: readonly (readonly [number, number, number])[];
};

/** PL00.ARC 起於 LBA 1149；調色盤區塊在檔內偏移 0x800，即第二個扇區。 */
export const X4_FALCON_SPEC: PalettePatchSpec = {
  lba: 1150,
  bytes: X4_PALETTE_BYTES,
  crcOriginal: X4_PALETTE_CRC_ORIGINAL,
  crcPatched: X4_PALETTE_CRC_PATCHED,
  acceptedCrcs: [X4_GAIA_CRC_PATCHED],
  changes: X4_FALCON_CHANGES,
};

/** 蓋亞配色：同一批顏色位置，改成黑鐵 → 槍灰 → 銀 → 白。 */
export const X4_GAIA_SPEC: PalettePatchSpec = {
  lba: 1150,
  bytes: X4_PALETTE_BYTES,
  crcOriginal: X4_PALETTE_CRC_ORIGINAL,
  crcPatched: X4_GAIA_CRC_PATCHED,
  acceptedCrcs: [X4_PALETTE_CRC_PATCHED],
  changes: X4_GAIA_CHANGES,
};

export type X4PaletteSkin = "falcon" | "gaia";
export const X4_PALETTE_SKINS: Record<X4PaletteSkin, { label: string; spec: PalettePatchSpec }> = {
  falcon: { label: "獵鷹", spec: X4_FALCON_SPEC },
  gaia: { label: "蓋亞", spec: X4_GAIA_SPEC },
};

export type PatchStatus = "patched" | "already";
export type PatchOutcome = { blob: Blob; status: PatchStatus; changed: number };

/* ------------------------------------------------------------------ */
/*  CRC32、EDC 與 ECC                                                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const EDC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let e = i;
    for (let k = 0; k < 8; k++) e = e & 1 ? (e >>> 1) ^ 0xd8018001 : e >>> 1;
    t[i] = e >>> 0;
  }
  return t;
})();

const ECC_F = new Uint8Array(256);
const ECC_B = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const j = ((i << 1) ^ (i & 0x80 ? 0x11d : 0)) & 0xff;
  ECC_F[i] = j;
  ECC_B[i ^ j] = i;
}

function edc(bytes: Uint8Array, from: number, to: number): number {
  let c = 0;
  for (let i = from; i < to; i++) c = ((c >>> 8) ^ EDC_TABLE[(c ^ bytes[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

function eccGenerate(
  s: Uint8Array,
  base: number,
  majorCount: number,
  minorCount: number,
  majorMult: number,
  minorInc: number,
  destOffset: number,
) {
  const size = majorCount * minorCount;
  for (let major = 0; major < majorCount; major++) {
    let index = (major >> 1) * majorMult + (major & 1);
    let a = 0;
    let b = 0;
    for (let minor = 0; minor < minorCount; minor++) {
      const t = s[base + index];
      index += minorInc;
      if (index >= size) index -= size;
      a ^= t;
      b ^= t;
      a = ECC_F[a];
    }
    a = ECC_B[ECC_F[a] ^ b];
    s[destOffset + major] = a;
    s[destOffset + major + majorCount] = a ^ b;
  }
}

/** 回傳一份重算過 EDC／ECC 的 Mode 2 Form 1 扇區（2352 位元組）。 */
export function fixSector(sector: Uint8Array): Uint8Array {
  if (sector.length !== SECTOR) throw new Error("扇區長度必須是 2352 位元組");
  const s = new Uint8Array(sector);
  const e = edc(s, 16, 2072);
  s[2072] = e & 0xff;
  s[2073] = (e >>> 8) & 0xff;
  s[2074] = (e >>> 16) & 0xff;
  s[2075] = (e >>> 24) & 0xff;
  // Mode 2 的 ECC 計算時，4 位元組的位址欄視為 0
  const address = s.slice(12, 16);
  s.fill(0, 12, 16);
  eccGenerate(s, 12, 86, 24, 2, 86, 0x81c);
  eccGenerate(s, 12, 52, 43, 86, 88, 0x8c8);
  s.set(address, 12);
  return s;
}

/* ------------------------------------------------------------------ */
/*  套用補丁                                                           */
/* ------------------------------------------------------------------ */

async function readSector(bin: Blob, lba: number): Promise<Uint8Array> {
  return new Uint8Array(await bin.slice(lba * SECTOR, (lba + 1) * SECTOR).arrayBuffer());
}

/** 套用調色盤補丁。傳入的映像不是預期的光碟時丟出錯誤，不會改動任何內容。 */
export async function applyPalettePatch(bin: Blob, spec: PalettePatchSpec = X4_FALCON_SPEC): Promise<PatchOutcome> {
  const sectorCount = Math.ceil(spec.bytes / DATA_LENGTH);
  if (bin.size % SECTOR !== 0) {
    throw new Error("這不是 2352 位元組／扇區的 BIN 映像（請使用 MODE2/2352 的 .bin）");
  }
  if (bin.size < (spec.lba + sectorCount) * SECTOR) {
    throw new Error("映像檔太小，不是完整的日版《洛克人X4》光碟");
  }

  const sectors: Uint8Array[] = [];
  for (let i = 0; i < sectorCount; i++) {
    const raw = await readSector(bin, spec.lba + i);
    if (!SYNC.every((b, k) => raw[k] === b)) throw new Error("映像檔的扇區格式不正確（缺少同步碼）");
    if (raw[15] !== 2 || raw[18] & 0x20) throw new Error("不是 Mode 2 Form 1 的資料扇區");
    sectors.push(raw);
  }

  const palette = new Uint8Array(sectorCount * DATA_LENGTH);
  sectors.forEach((raw, i) => palette.set(raw.subarray(DATA_OFFSET, DATA_OFFSET + DATA_LENGTH), i * DATA_LENGTH));
  const current = crc32(palette.subarray(0, spec.bytes));

  if (current === spec.crcPatched) return { blob: bin, status: "already", changed: 0 };
  const accepted = current === spec.crcOriginal || (spec.acceptedCrcs ?? []).includes(current);
  if (!accepted) {
    throw new Error("這不是日版《洛克人X4》（SLPS-00902）的光碟映像，或內容已被修改，補丁未套用");
  }

  const view = new DataView(palette.buffer);
  let changed = 0;
  for (const [pal, color, word] of spec.changes) {
    const at = pal * 32 + color * 2;
    if (at + 2 > spec.bytes) throw new Error("補丁資料超出調色盤範圍");
    if (view.getUint16(at, true) !== word) changed++;
    view.setUint16(at, word, true);
  }
  if (crc32(palette.subarray(0, spec.bytes)) !== spec.crcPatched) {
    throw new Error("補丁自我檢查失敗，已中止");
  }

  const patched = sectors.map((raw, i) => {
    const next = new Uint8Array(raw);
    next.set(palette.subarray(i * DATA_LENGTH, (i + 1) * DATA_LENGTH), DATA_OFFSET);
    return fixSector(next) as unknown as BlobPart;
  });
  const blob = new Blob(
    [bin.slice(0, spec.lba * SECTOR), ...patched, bin.slice((spec.lba + sectorCount) * SECTOR)],
    { type: "application/octet-stream" },
  );
  return { blob, status: "patched", changed };
}

/** 日版《洛克人X4》專用：寫入獵鷹配色。 */
export function applyX4FalconPalette(bin: Blob): Promise<PatchOutcome> {
  return applyPalettePatch(bin, X4_FALCON_SPEC);
}

/** 日版《洛克人X4》專用：寫入蓋亞配色（白黑重裝）。 */
export function applyX4GaiaPalette(bin: Blob): Promise<PatchOutcome> {
  return applyPalettePatch(bin, X4_GAIA_SPEC);
}

/** 依選擇寫入配色；來源可以是原版映像，或已套用另一種配色的映像。 */
export function applyX4PaletteSkin(bin: Blob, skin: X4PaletteSkin): Promise<PatchOutcome> {
  return applyPalettePatch(bin, X4_PALETTE_SKINS[skin].spec);
}
