/**
 * アプリアイコン（public/icon-192.png・icon-512.png・apple-touch-icon.png）を生成する。
 *
 * PFシリーズ共通の作り方に合わせている：
 * - 全面ベタの正方形（角丸は表示側の CSS が付けるので、画像には焼き込まない）
 * - 左上→右下の斜めグラデーション
 * - 中央に lucide のアイコンを白の線画で置く（24 の座標系を 4 倍して 192 の中央に配置）
 *
 * グリフは lucide "clock"（決められた時刻に進捗をチェックする、というアプリの中身）。
 * 線は「図形からの距離」で描くので、round cap / round join が自然に出る。
 *
 *   node scripts/make-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** 基準となる座標系（192×192）。出力サイズが変わっても比率は変えない。 */
const BASE = 192;

/** 背景グラデーション（左上 → 右下）。茶系。 */
const FROM = [169, 113, 66]; // #a97142
const TO = [74, 44, 23]; // #4a2c17

/** 線の太さ（192 の座標系で）。lucide の stroke-width 2.5 × 4。 */
const STROKE = 10;

/**
 * グリフ（192 の座標系）。
 * lucide "clock"（circle cx12 cy12 r10 / path M12 6v6l4 2）を
 * translate(48,48) scale(4) したもの。
 */
const POLYLINES = [
  [
    [96, 72],
    [96, 96],
    [112, 104],
  ],
];

const CIRCLES = [{ cx: 96, cy: 96, r: 40 }];

/** 点 p と線分 ab の距離。round cap / round join はこの距離だけで表現できる。 */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** グリフ全体（折れ線＋円）からの最短距離。円は「輪郭までの距離」。 */
function distToGlyph(px, py) {
  let min = Infinity;
  for (const line of POLYLINES) {
    for (let i = 0; i + 1 < line.length; i++) {
      const d = distToSegment(px, py, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
      if (d < min) min = d;
    }
  }
  for (const c of CIRCLES) {
    const d = Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r);
    if (d < min) min = d;
  }
  return min;
}

/** 指定サイズの RGB 画素を作る（1画素あたり 3×3 のサブサンプルでアンチエイリアス）。 */
function render(size) {
  const scale = size / BASE;
  const half = STROKE / 2;
  const px = Buffer.alloc(size * size * 3);
  const SUB = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景：左上→右下の線形グラデーション
      const t = Math.min(1, Math.max(0, (x + y + 1) / (2 * size)));
      const bg = [
        FROM[0] + (TO[0] - FROM[0]) * t,
        FROM[1] + (TO[1] - FROM[1]) * t,
        FROM[2] + (TO[2] - FROM[2]) * t,
      ];
      // 白線の被覆率をサブサンプルで求める
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const gx = (x + (sx + 0.5) / SUB) / scale;
          const gy = (y + (sy + 0.5) / SUB) / scale;
          if (distToGlyph(gx, gy) <= half) hits++;
        }
      }
      const a = hits / (SUB * SUB);
      const o = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(bg[c] * (1 - a) + 255 * a);
      }
    }
  }
  return px;
}

/** RGB 画素を PNG（8bit・カラータイプ2＝RGB）にする。 */
function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // フィルタなし
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const outDir = path.join(process.cwd(), "public");
for (const [size, name] of [
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [180, "apple-touch-icon.png"],
]) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`${name} (${size}x${size}) を書き出しました`);
}
