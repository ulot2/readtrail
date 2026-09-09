// Draws the toolbar icon at every size Chrome asks for.
//
// Chrome will not take an SVG for an extension icon, and a design tool would put
// four binary files in the repository with no way to change them. This writes PNG
// with node:zlib alone, so the icon stays editable: change the numbers, run it again.
//
// Run with: npm run icons

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BACKGROUND = [0x16, 0x30, 0x5e, 0xff]; // deep blue, readable on light and dark toolbars
const INK = [0xff, 0xff, 0xff, 0xff];
const RADIUS = 0.22; // of the icon width
const SAMPLE = 4; // draw this many times bigger, then average down, which is the anti-aliasing

// Three lines of stored text. The short last line is what makes it read as text
// and not as a menu. Values are fractions of the icon width.
const BARS = [
  { x: 0.23, y: 0.235, w: 0.54, h: 0.135 },
  { x: 0.23, y: 0.4325, w: 0.54, h: 0.135 },
  { x: 0.23, y: 0.63, w: 0.32, h: 0.135 },
];

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0, because these images are tiny
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type 6 is RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const big = size * SAMPLE;
  const radius = big * RADIUS;
  const bars = BARS.map((b) => ({
    x0: b.x * big,
    y0: b.y * big,
    x1: (b.x + b.w) * big,
    y1: (b.y + b.h) * big,
  }));

  // A point is inside the rounded square when its distance past the straight
  // edges stays within the corner radius.
  const onCard = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (big - radius));
    const dy = Math.max(radius - y, 0, y - (big - radius));
    return dx * dx + dy * dy <= radius * radius;
  };

  const onInk = (x, y) => bars.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);

  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0, 0];

      for (let sy = 0; sy < SAMPLE; sy++) {
        for (let sx = 0; sx < SAMPLE; sx++) {
          const px = x * SAMPLE + sx + 0.5;
          const py = y * SAMPLE + sy + 0.5;
          const colour = !onCard(px, py) ? [0, 0, 0, 0] : onInk(px, py) ? INK : BACKGROUND;
          for (let c = 0; c < 4; c++) total[c] += colour[c];
        }
      }

      const at = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) out[at + c] = Math.round(total[c] / (SAMPLE * SAMPLE));
    }
  }

  return out;
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = `icons/icon-${size}.png`;
  writeFileSync(file, png(size, draw(size)));
  console.log(file);
}
