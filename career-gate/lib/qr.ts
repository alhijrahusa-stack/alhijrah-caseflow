import "server-only";

const VERSION = 5;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function generator(degree: number) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomon(data: Uint8Array, degree: number) {
  const divisor = generator(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

function appendBits(bits: boolean[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) bits.push(((value >>> i) & 1) !== 0);
}

function dataCodewords(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 106) throw new Error("QR payload exceeds fixed Version 5-L capacity");
  const bits: boolean[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(false);
  const data = new Uint8Array(DATA_CODEWORDS);
  let count = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] ? 1 : 0);
    data[count++] = value;
  }
  for (let pad = 0; count < DATA_CODEWORDS; count++, pad++) data[count] = pad % 2 === 0 ? 0xec : 0x11;
  return data;
}

function formatBits(mask: number) {
  const data = (1 << 3) | mask; // ECL L = 01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function buildMatrix(text: string) {
  const data = dataCodewords(text);
  const ecc = reedSolomon(data, ECC_CODEWORDS);
  const codewords = new Uint8Array(DATA_CODEWORDS + ECC_CODEWORDS);
  codewords.set(data);
  codewords.set(ecc, DATA_CODEWORDS);
  const bits: boolean[] = [];
  for (const byte of codewords) appendBits(bits, byte, 8);

  const modules = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const fn = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    fn[y][x] = true;
  };

  for (let i = 0; i < SIZE; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(SIZE - 4, 3);
  finder(3, SIZE - 4);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFunction(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);

  const drawFormat = (mask: number) => {
    const bits15 = formatBits(mask);
    const bit = (i: number) => ((bits15 >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
    setFunction(8, 7, bit(6));
    setFunction(8, 8, bit(7));
    setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFunction(SIZE - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFunction(8, SIZE - 15 + i, bit(i));
    setFunction(8, SIZE - 8, true);
  };
  drawFormat(0);

  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < SIZE; vert++) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (fn[y][x]) continue;
        let dark = bitIndex < bits.length ? bits[bitIndex] : false;
        bitIndex++;
        if ((x + y) % 2 === 0) dark = !dark;
        modules[y][x] = dark;
      }
    }
  }
  drawFormat(0);
  return modules;
}

export function qrSvg(text: string) {
  const matrix = buildMatrix(text);
  const margin = 4;
  const scale = 6;
  const view = (SIZE + margin * 2) * scale;
  const paths: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) if (matrix[y][x]) paths.push(`M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${view}" height="${view}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${paths.join("")}" fill="#07111f"/></svg>`;
}
