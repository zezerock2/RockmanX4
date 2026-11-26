import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/zipPack.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const module_ = { exports: {} };
// zipPack.ts 沒有 import,給一個空的 require 以防萬一
new Function("exports", "module", "require", compiled)(module_.exports, module_, () => ({}));
const { packFiles } = module_.exports;

const encoder = new TextEncoder();

/** 讀回 ZIP:解析中央目錄,回傳 { 檔名: 內容 }。 */
async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, "ZIP 必須有結束標記");
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(pointer, true), 0x02014b50, "中央目錄標頭");
    const crc = view.getUint32(pointer + 16, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, "本地標頭");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    const data = bytes.subarray(dataStart, dataStart + size);
    files[name] = { data, crc, size };
    pointer += 46 + nameLength;
  }
  return files;
}

const CUE = 'FILE "洛克人_X5.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n';

test("雙檔案:cue 與 bin 一起打包,FILE 檔名改寫成一致", async () => {
  const cue = new File([encoder.encode(CUE)], "洛克人_X5.cue", { lastModified: 1_700_000_000_000 });
  const bin = new File([encoder.encode("DISC-IMAGE-BYTES")], "洛克人_X5.bin", { lastModified: 1_700_000_000_000 });

  const result = await packFiles([cue, bin]);
  assert.equal(result.name, "洛克人_X5", "顯示名稱取 cue 主檔名,用來判斷 X4/X5");
  assert.deepEqual(
    result.entries.map((entry) => [entry.original, entry.stored]),
    [
      ["洛克人_X5.cue", "game.cue"],
      ["洛克人_X5.bin", "game.bin"],
    ],
  );
  assert.deepEqual(result.missing, []);

  const zip = await readZip(result.blob);
  assert.deepEqual(Object.keys(zip).sort(), ["game.bin", "game.cue"]);
  const cueText = new TextDecoder().decode(zip["game.cue"].data);
  assert.match(cueText, /^FILE "game\.bin" BINARY/, "FILE 行已改寫");
  assert.match(cueText, /TRACK 01 MODE2\/2352/, "軌道資訊保留");
  assert.match(cueText, /INDEX 01 00:00:00/);
  assert.equal(new TextDecoder().decode(zip["game.bin"].data), "DISC-IMAGE-BYTES");
});

test("Big5 編碼的 cue 也能解出來配對", async () => {
  // Big5 檔頭:洛 ac a5 / 克 a7 4a / 人 a4 48,其餘為 ASCII
  const big5 = [0xac, 0xa5, 0xa7, 0x4a, 0xa4, 0x48, 0x5f, 0x58, 0x35, 0x2e, 0x62, 0x69, 0x6e];
  const bytes = new Uint8Array([
    ...encoder.encode('FILE "'),
    ...big5,
    ...encoder.encode('" BINARY\r\n  TRACK 01 MODE2/2352\r\n'),
  ]);
  const cue = new File([bytes], "洛克人_X5.cue");
  const bin = new File([encoder.encode("IMAGE")], "洛克人_X5.bin");

  const result = await packFiles([cue, bin]);
  assert.deepEqual(result.missing, [], "Big5 檔名要能對上選取的檔案");
  const zip = await readZip(result.blob);
  assert.match(new TextDecoder().decode(zip["game.cue"].data), /FILE "game\.bin" BINARY/);
});

test("cue 引用了沒選的檔案會回報 missing", async () => {
  const cueText =
    'FILE "洛克人_X5.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "track2.bin" BINARY\r\n  TRACK 02 MODE2/2352\r\n';
  const cue = new File([encoder.encode(cueText)], "洛克人_X5.cue");
  const bin = new File([encoder.encode("IMAGE")], "洛克人_X5.bin");
  const result = await packFiles([cue, bin]);
  assert.deepEqual(result.missing, ["track2.bin"], "缺的軌道要回報,不能靜默漏掉");
  const zip = await readZip(result.blob);
  const text = new TextDecoder().decode(zip["game.cue"].data);
  assert.match(text, /FILE "game-1\.bin" BINARY/, "配對到的照常改寫");
  assert.match(text, /FILE "track2\.bin" BINARY/, "配不到的保留原名");
});

test("多個 bin 的 cue 依序命名 game-1 / game-2", async () => {
  const cueText = 'FILE "track1.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "track2.bin" BINARY\r\n  TRACK 02 MODE2/2352\r\n';
  const cue = new File([encoder.encode(cueText)], "disc.cue");
  const one = new File([encoder.encode("ONE")], "track1.bin");
  const two = new File([encoder.encode("TWO")], "track2.bin");

  const result = await packFiles([cue, one, two]);
  assert.deepEqual(
    result.entries.map((entry) => entry.stored),
    ["game.cue", "game-1.bin", "game-2.bin"],
  );
  const zip = await readZip(result.blob);
  const text = new TextDecoder().decode(zip["game.cue"].data);
  assert.match(text, /FILE "game-1\.bin" BINARY/);
  assert.match(text, /FILE "game-2\.bin" BINARY/);
});

test("沒有 cue 時仍會打包,第一個檔案命名為 game", async () => {
  const one = new File([encoder.encode("ONE")], "a.bin");
  const two = new File([encoder.encode("TWO")], "b.chd");
  const result = await packFiles([one, two]);
  assert.deepEqual(
    result.entries.map((entry) => entry.stored),
    ["game.bin", "extra-1.chd"],
  );
  const zip = await readZip(result.blob);
  assert.equal(new TextDecoder().decode(zip["game.bin"].data), "ONE");
  assert.equal(new TextDecoder().decode(zip["extra-1.chd"].data), "TWO");
});

test("CRC32 與已知值一致,進度會回報到 100%", async () => {
  const known = new File(["123456789"], "crc.bin");
  const result = await packFiles([known], (done, total) => {
    assert.ok(done <= total);
  });
  const zip = await readZip(result.blob);
  // CRC32("123456789") = 0xCBF43926
  assert.equal(zip["game.bin"].crc, 0xcbf43926);

  let last = 0;
  let calls = 0;
  await packFiles([new File([new Uint8Array(200_000)], "big.bin")], (done, total) => {
    calls += 1;
    assert.ok(done >= last);
    last = done;
    assert.equal(total, 200_000);
  });
  assert.equal(last, 200_000, "進度要走滿");
  assert.ok(calls > 1, "大檔要分段回報");
});
