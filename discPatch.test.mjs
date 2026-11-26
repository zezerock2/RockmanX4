import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

const palette = { exports: {} };
new Function("exports", "module", "require", compile("../src/lib/falconPalette.ts"))(palette.exports, palette, () => ({}));
const disc = { exports: {} };
new Function("exports", "module", "require", compile("../src/lib/discPatch.ts"))(disc.exports, disc, () => palette.exports);
const { fixSector, crc32, applyPalettePatch, applyX4PaletteSkin, X4_FALCON_SPEC, X4_GAIA_SPEC } = disc.exports;

const S = 2352;
const SYNC = [0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0];
const hex = (u8) => Buffer.from(u8).toString("hex");

function makeSector(fill, lba = 0, form2 = false) {
  const s = new Uint8Array(S);
  s.set(SYNC, 0);
  s.set([0x00, 0x02, lba & 0xff, 0x02], 12);
  s.set(form2 ? [0, 0, 0x20, 0, 0, 0, 0x20, 0] : [0, 0, 8, 0, 0, 0, 8, 0], 16);
  for (let i = 0; i < 2048; i++) s[24 + i] = fill(i);
  return s;
}

/** 合成光碟：每個扇區填入可預測的內容，調色盤區塊放在指定扇區。 */
function makeDisc(sectors, lba, paletteBytes) {
  const parts = [];
  for (let i = 0; i < sectors; i++) {
    const s = makeSector((k) => (i * 31 + k * 5) & 255, i);
    if (i === lba || i === lba + 1) {
      for (let k = 0; k < 2048; k++) {
        const at = (i - lba) * 2048 + k;
        s[24 + k] = at < paletteBytes.length ? paletteBytes[at] : 0xee;
      }
    }
    parts.push(fixSector(s));
  }
  return new Blob(parts);
}

test("fixSector 與對真實光碟驗證過的參考實作一致", () => {
  const sec = makeSector((i) => (i * 7 + 3) & 255, 0x17);
  const out = fixSector(sec);
  assert.equal(hex(out.subarray(2072, 2076)), "fb6f07d7", "EDC");
  assert.equal(hex(out.subarray(0x81c, 0x81c + 8)), "7e5cc75e27a46581", "P 同位元開頭");
  assert.equal(hex(out.subarray(0x81c + 164, 0x81c + 172)), "6c08361067d1580d", "P 同位元結尾");
  assert.equal(hex(out.subarray(0x8c8, 0x8c8 + 8)), "7055ee8444494076", "Q 同位元開頭");
  assert.equal(hex(out.subarray(0x8c8 + 96, 0x8c8 + 104)), "672dea96b66e21a9", "Q 同位元結尾");
  assert.equal(hex(out.subarray(12, 16)), "00021702", "位址欄保持不變（ECC 計算時才視為 0）");
  assert.deepEqual([...out.subarray(24, 2072)], [...sec.subarray(24, 2072)], "資料不被改動");
  assert.notEqual(out, sec, "回傳的是副本");
});

test("fixSector 是冪等的：已正確的扇區再算一次不變", () => {
  const once = fixSector(makeSector((i) => (i * 13) & 255));
  assert.deepEqual([...fixSector(once)], [...once]);
});

test("fixSector 拒絕長度不對的輸入", () => {
  assert.throws(() => fixSector(new Uint8Array(2048)), /2352/);
});

test("crc32 與已知值一致", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("X4 規格：只改藍色、不會產生透明色、位址都在調色盤範圍內", () => {
  const { changes, bytes } = X4_FALCON_SPEC;
  assert.equal(changes.length, 173);
  assert.equal(bytes, 2464);
  for (const [pal, color, word] of changes) {
    assert.ok(pal >= 0 && pal < 77, "調色盤序號在 0–76");
    assert.ok(color >= 1 && color <= 15, "顏色序號從 1 開始，0 號保持透明");
    assert.ok(word > 0 && word < 0x8000, "不是 0x0000，且為有效的 15 位元色");
    assert.ok(pal * 32 + color * 2 + 2 <= bytes);
  }
  const keys = changes.map(([p, c]) => `${p}:${c}`);
  assert.equal(new Set(keys).size, keys.length, "沒有重複的項目");
});

test("蓋亞規格與獵鷹改同一批顏色位置，因此兩種配色可以互相切換", () => {
  assert.equal(X4_GAIA_SPEC.changes.length, 173);
  assert.equal(X4_GAIA_SPEC.lba, X4_FALCON_SPEC.lba);
  assert.equal(X4_GAIA_SPEC.bytes, X4_FALCON_SPEC.bytes);
  assert.equal(X4_GAIA_SPEC.crcOriginal, X4_FALCON_SPEC.crcOriginal);
  assert.notEqual(X4_GAIA_SPEC.crcPatched, X4_FALCON_SPEC.crcPatched);
  assert.deepEqual(
    X4_GAIA_SPEC.changes.map(([p, c]) => `${p}:${c}`),
    X4_FALCON_SPEC.changes.map(([p, c]) => `${p}:${c}`),
    "identical slots, different colours",
  );
  for (const [, , word] of X4_GAIA_SPEC.changes) assert.ok(word > 0 && word < 0x8000);
});

// 合成規格：不需要任何真實遊戲檔案就能測完整流程
const ORIGINAL = Uint8Array.from({ length: 2464 }, (_, i) => (i * 3 + 1) & 255);
const spec = {
  lba: 40,
  bytes: 2464,
  crcOriginal: crc32(ORIGINAL),
  crcPatched: 0,
  changes: [
    [0, 12, 0x6350],
    [0, 13, 0x62ec],
    [5, 7, 0x44a3],
    [76, 15, 0x1234],
  ],
};
{
  const expected = new Uint8Array(ORIGINAL);
  const v = new DataView(expected.buffer);
  for (const [p, c, w] of spec.changes) v.setUint16(p * 32 + c * 2, w, true);
  spec.crcPatched = crc32(expected);
  spec.expected = expected;
}
// 第二種配色（合成）：改的是同樣的位置、不同的顏色，並接受第一種配色作為起點
const gaiaSpec = {
  lba: 40,
  bytes: 2464,
  crcOriginal: spec.crcOriginal,
  crcPatched: 0,
  acceptedCrcs: [spec.crcPatched],
  changes: [
    [0, 12, 0x2945],
    [0, 13, 0x39ce],
    [5, 7, 0x4a52],
    [76, 15, 0x5ad6],
  ],
};
{
  const expected = new Uint8Array(ORIGINAL);
  const v = new DataView(expected.buffer);
  for (const [p, c, w] of gaiaSpec.changes) v.setUint16(p * 32 + c * 2, w, true);
  gaiaSpec.crcPatched = crc32(expected);
  gaiaSpec.expected = expected;
}

test("套用補丁：只改兩個扇區，其餘位元組原樣，校驗碼有重算", async () => {
  const bin = makeDisc(80, spec.lba, ORIGINAL);
  const out = await applyPalettePatch(bin, spec);
  assert.equal(out.status, "patched");
  assert.equal(out.changed, 4);
  assert.equal(out.blob.size, bin.size, "大小不變");

  const a = Buffer.from(await bin.arrayBuffer());
  const b = Buffer.from(await out.blob.arrayBuffer());
  const touched = [];
  for (let i = 0; i < 80; i++) if (!a.subarray(i * S, (i + 1) * S).equals(b.subarray(i * S, (i + 1) * S))) touched.push(i);
  assert.deepEqual(touched, [40, 41], "只有調色盤所在的兩個扇區不同");

  const data = Buffer.concat([b.subarray(40 * S + 24, 40 * S + 24 + 2048), b.subarray(41 * S + 24, 41 * S + 24 + 2048)]);
  assert.deepEqual([...data.subarray(0, 2464)], [...spec.expected], "調色盤內容正確");
  assert.equal(data[2464], 0xee, "調色盤區塊之後的資料不動");

  for (const i of touched) {
    const sector = new Uint8Array(b.subarray(i * S, (i + 1) * S));
    assert.deepEqual([...fixSector(sector)], [...sector], `扇區 ${i} 的 EDC／ECC 正確`);
  }
});

test("重複套用會被辨識為已套用，並回傳同一個 Blob", async () => {
  const first = await applyPalettePatch(makeDisc(80, spec.lba, ORIGINAL), spec);
  const second = await applyPalettePatch(first.blob, spec);
  assert.equal(second.status, "already");
  assert.equal(second.blob, first.blob);
  assert.equal(second.changed, 0);
});

test("已套用一種配色的映像可以直接換成另一種配色", async () => {
  const first = await applyPalettePatch(makeDisc(80, spec.lba, ORIGINAL), spec);
  const switched = await applyPalettePatch(first.blob, gaiaSpec);
  assert.equal(switched.status, "patched");
  const b = Buffer.from(await switched.blob.arrayBuffer());
  const data = Buffer.concat([b.subarray(40 * S + 24, 40 * S + 24 + 2048), b.subarray(41 * S + 24, 41 * S + 24 + 2048)]);
  assert.deepEqual([...data.subarray(0, 2464)], [...gaiaSpec.expected], "換色後的調色盤正確，沒有殘留前一種配色");
  const again = await applyPalettePatch(switched.blob, gaiaSpec);
  assert.equal(again.status, "already");
  assert.equal(typeof applyX4PaletteSkin, "function");
});

test("不是預期的光碟時拒絕，且不產生新映像", async () => {
  const other = makeDisc(80, spec.lba, Uint8Array.from({ length: 2464 }, (_, i) => (i * 5) & 255));
  await assert.rejects(applyPalettePatch(other, spec), /不是日版《洛克人X4》/);
});

test("格式不對的檔案都有明確的錯誤", async () => {
  await assert.rejects(applyPalettePatch(new Blob([new Uint8Array(1000)]), spec), /2352/);
  await assert.rejects(applyPalettePatch(new Blob([new Uint8Array(S * 10)]), spec), /太小/);
  const broken = makeDisc(80, spec.lba, ORIGINAL);
  const bytes = Buffer.from(await broken.arrayBuffer());
  bytes[40 * S] = 0x55; // 破壞同步碼
  await assert.rejects(applyPalettePatch(new Blob([bytes]), spec), /同步碼/);
  const form2 = Buffer.from(await makeDisc(80, spec.lba, ORIGINAL).arrayBuffer());
  form2[40 * S + 18] = 0x20; // 子標頭標成 Form 2
  await assert.rejects(applyPalettePatch(new Blob([form2]), spec), /Form 1/);
});
