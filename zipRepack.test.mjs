import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/zipPack.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const holder = { exports: {} };
new Function("exports", "module", "require", compiled)(holder.exports, holder, () => ({}));
const { prepareZip, planCue } = holder.exports;

const enc = new TextEncoder();
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 測試用 ZIP 寫入器。method 0 = 存放、8 = deflate。
 * 給 nameBytes 時不設 UTF-8 旗標，檔名以原始位元組寫入（模擬 Windows 系統編碼的舊式 ZIP）。
 */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.nameBytes ?? enc.encode(e.name));
    const data = Buffer.from(e.data);
    const packed = e.method === 8 ? deflateRawSync(data) : data;
    const flags = e.nameBytes ? 0 : 0x800;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** 獨立的讀回器：解開每個條目並檢查 CRC，和被測程式的寫入邏輯互不共用程式碼。 */
function readBack(buf) {
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    out[name] = { flags, method, data, crcOk: crc32(data) === crc };
    p += 46 + nameLen;
  }
  return out;
}

const DISC = Buffer.from("SIMULATED-DISC-SECTORS-".repeat(2000));
const CUE_TAIL = " BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n";

test("一致的 UTF-8 壓縮包原樣回傳，不做任何複製", async () => {
  const zip = makeZip([
    { name: "洛克人_X5.cue", data: Buffer.from(`FILE "洛克人_X5.bin"${CUE_TAIL}`), method: 8 },
    { name: "洛克人_X5.bin", data: DISC, method: 8 },
  ]);
  const file = new File([zip], "洛克人_X5.zip");
  const prep = await prepareZip(file);
  assert.equal(prep.repacked, false);
  assert.equal(prep.blob, file, "nothing to fix, so the same file goes straight to the emulator");
  assert.equal(prep.name, "洛克人_X5");
});

test("X5 式 Big5 cue：重組後 cue 指向 game.bin，光碟資料位元組不變", async () => {
  // 洛克人_X5.bin 的 Big5 位元組，與 X5 光碟包的 cue 相同
  const big5Name = Buffer.from([0xac, 0xa5, 0xa7, 0x4a, 0xa4, 0x48, 0x5f, 0x58, 0x35, 0x2e, 0x62, 0x69, 0x6e]);
  const cue = Buffer.concat([Buffer.from('FILE "'), big5Name, Buffer.from(`"${CUE_TAIL}`)]);
  const zip = makeZip([
    { name: "洛克人_X5.cue", data: cue, method: 8 },
    { name: "洛克人_X5.bin", data: DISC, method: 8 },
  ]);
  const prep = await prepareZip(new File([zip], "洛克人_X5.zip"));
  assert.equal(prep.repacked, true);
  const out = readBack(Buffer.from(await prep.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(out), ["game.cue", "game.bin"]);
  assert.match(out["game.cue"].data.toString("utf8"), /^FILE "game\.bin" BINARY\r\n {2}TRACK 01 MODE2\/2352/);
  assert.equal(out["game.bin"].data.equals(DISC), true, "disc bytes are copied, not altered");
  assert.equal(out["game.cue"].crcOk && out["game.bin"].crcOk, true, "every entry passes its CRC");
  assert.equal(out["game.cue"].flags & 0x800, 0x800, "names are written as UTF-8");
  assert.equal(prep.name, "洛克人_X5");
});

test("X4 式檔名不一致（cue 寫 [SLPS-00902]，實際 bin 叫 (Japan)）：依序配對並改名，說明檔保留", async () => {
  const cue = 'FILE "Rockman X4 (J) [SLPS-00902].bin"' + CUE_TAIL;
  const zip = makeZip([
    { name: "Rockman X4 (Japan)/readme.html", data: Buffer.from("<html>readme</html>"), method: 0 },
    { name: "Rockman X4 (Japan)/Rockman X4 (Japan).cue", data: Buffer.from(cue), method: 8 },
    { name: "Rockman X4 (Japan)/Rockman X4 (Japan).bin", data: DISC, method: 0 },
  ]);
  const prep = await prepareZip(new File([zip], "Rockman X4 (Japan).zip"));
  assert.equal(prep.repacked, true);
  const out = readBack(Buffer.from(await prep.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(out), ["game.cue", "game.bin", "Rockman X4 (Japan)/readme.html"]);
  assert.match(out["game.cue"].data.toString("utf8"), /^FILE "game\.bin" BINARY/);
  assert.equal(out["game.bin"].data.equals(DISC), true);
  assert.equal(out["Rockman X4 (Japan)/readme.html"].data.toString(), "<html>readme</html>");
  assert.equal(
    Object.values(out).every((entry) => entry.crcOk),
    true,
  );
});

test("舊式 ZIP（檔名沒有 UTF-8 旗標，為 Big5 位元組）也會被重組", async () => {
  const big5Name = Buffer.from([0xac, 0xa5, 0xa7, 0x4a, 0xa4, 0x48, 0x5f, 0x58, 0x35, 0x2e, 0x62, 0x69, 0x6e]);
  const cue = Buffer.concat([Buffer.from('FILE "'), big5Name, Buffer.from(`"${CUE_TAIL}`)]);
  const zip = makeZip([
    { name: "disc.cue", nameBytes: Buffer.from("disc.cue"), data: cue, method: 8 },
    { name: "bin", nameBytes: big5Name, data: DISC, method: 8 },
  ]);
  const prep = await prepareZip(new File([zip], "legacy.zip"));
  assert.equal(prep.repacked, true, "the decoded name is not the same bytes the cue carries");
  const out = readBack(Buffer.from(await prep.blob.arrayBuffer()));
  assert.equal(out["game.bin"].data.equals(DISC), true);
});

test("cue 指向壓縮檔內不存在的檔案時，明確報出缺的檔名", async () => {
  const cue = 'FILE "A.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "B.bin" BINARY\r\n  TRACK 02 MODE2/2352\r\n';
  const zip = makeZip([
    { name: "disc.cue", data: Buffer.from(cue), method: 8 },
    { name: "X.bin", data: DISC, method: 8 },
  ]);
  await assert.rejects(prepareZip(new File([zip], "disc.zip")), /A\.bin、B\.bin/);
});

test("沒有 cue 的壓縮包原樣回傳", async () => {
  const zip = makeZip([{ name: "game.chd", data: DISC, method: 0 }]);
  const file = new File([zip], "game.zip");
  const prep = await prepareZip(file);
  assert.equal(prep.repacked, false);
  assert.equal(prep.blob, file);
});

test("planCue：多軌依序命名 game-1 / game-2，缺檔保留原名", () => {
  const cue = 'FILE "track1.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "track2.bin" BINARY\r\n  TRACK 02 MODE2/2352\r\n';
  const plan = planCue(cue, [{ name: "track2.bin" }, { name: "track1.bin" }]);
  assert.deepEqual(plan.storedNames, ["game-2.bin", "game-1.bin"], "names follow the cue order, not the file order");
  assert.deepEqual(plan.missing, []);
  assert.match(plan.text, /FILE "game-1\.bin" BINARY[\s\S]*FILE "game-2\.bin" BINARY/);

  const partial = planCue(cue, [{ name: "track1.bin" }]);
  assert.deepEqual(partial.missing, ["track2.bin"]);
  assert.match(partial.text, /FILE "track2\.bin" BINARY/, "unpaired references stay as written");
});
