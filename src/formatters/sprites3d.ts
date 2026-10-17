/**
 * 3D Animated ASCII / Braille / Shaded Sprite Engine for Pyre TUI.
 *
 * Provides:
 * 1. Real-time 3D Phong-shaded Torus (Donut) renderer with z-buffer & TrueColor lighting
 * 2. 4D -> 3D -> 2D Rotating Hypercube (Tesseract) with 2x4 Braille sub-pixel anti-aliased wireframe
 * 3. 3D Dual-Ring Gyro-Reactor Core (Octahedron + Orbiting Rings + Rising Plasma Embers)
 * 4. 3D Isometric Shaded Cyber-Mascot ("IGNIS-3D") with reactive telemetry expressions & thrusters
 * 5. 3D Faceted Crystal Obelisk / Prism with orbiting telemetry satellites
 */
import chalk from 'chalk';
import { fitVisible, visLen } from './render.js';

export type Sprite3DMode = 'ignis' | 'torus' | 'tesseract' | 'reactor' | 'prism';

export const SPRITE_3D_MODES: Sprite3DMode[] = ['ignis', 'torus', 'tesseract', 'reactor', 'prism'];

export interface Sprite3DTelemetry {
  cpuUsage: number;
  memUsage: number;
  tempC?: number;
  rxRate?: number;
  txRate?: number;
  anomalyCount?: number;
}

const SHADE_RAMP = ' ·.,:;!+*?%S#@█';

/**
 * Draw a line into a 2x4 Braille sub-pixel grid (width = cols*2, height = rows*4)
 * with per-cell depth tracking.
 */
class BrailleCanvas3D {
  readonly cols: number;
  readonly rows: number;
  readonly subW: number;
  readonly subH: number;
  private dots: Uint8Array;
  private depth: Float32Array;
  private overlayChar: Map<number, { ch: string; color: (s: string) => string }>;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.subW = cols * 2;
    this.subH = rows * 4;
    this.dots = new Uint8Array(cols * rows);
    this.depth = new Float32Array(cols * rows).fill(-Infinity);
    this.overlayChar = new Map();
  }

  private static DOT_MAP = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ];

  setSubPixel(sx: number, sy: number, z = 0) {
    const x = Math.round(sx);
    const y = Math.round(sy);
    if (x < 0 || x >= this.subW || y < 0 || y >= this.subH) return;
    const cx = x >> 1;
    const cy = y >> 2;
    const idx = cy * this.cols + cx;
    this.dots[idx] |= BrailleCanvas3D.DOT_MAP[y & 3][x & 1];
    if (z > this.depth[idx]) {
      this.depth[idx] = z;
    }
  }

  drawLine3D(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const steps = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.setSubPixel(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        z0 + (z1 - z0) * t
      );
    }
  }

  setGlyph(cx: number, cy: number, ch: string, color: (s: string) => string, z = 10) {
    const x = Math.round(cx);
    const y = Math.round(cy);
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const idx = y * this.cols + x;
    if (z >= this.depth[idx]) {
      this.depth[idx] = z;
      this.overlayChar.set(idx, { ch, color });
    }
  }

  render(palette: { front: (s: string) => string; mid: (s: string) => string; back: (s: string) => string }): string[] {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let rowStr = '';
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const ov = this.overlayChar.get(idx);
        if (ov) {
          rowStr += ov.color(ov.ch);
          continue;
        }
        const mask = this.dots[idx];
        if (mask === 0) {
          rowStr += ' ';
        } else {
          const ch = String.fromCharCode(0x2800 + mask);
          const z = this.depth[idx];
          if (z > 0.25) rowStr += palette.front(ch);
          else if (z > -0.25) rowStr += palette.mid(ch);
          else rowStr += palette.back(ch);
        }
      }
      lines.push(rowStr);
    }
    return lines;
  }
}

/**
 * Determine dynamic color palette based on CPU load and temperature.
 */
function getReactivePalette(telemetry: Sprite3DTelemetry) {
  const hot = telemetry.cpuUsage >= 75 || (telemetry.tempC !== undefined && telemetry.tempC >= 80) || (telemetry.anomalyCount ?? 0) > 0;
  const warm = !hot && (telemetry.cpuUsage >= 40 || (telemetry.tempC !== undefined && telemetry.tempC >= 65));

  if (hot) {
    return {
      mood: 'OVERDRIVE',
      badgeColor: chalk.bgHex('#e11d48').white.bold,
      spec: chalk.hex('#ffffff').bold,
      front: chalk.hex('#fb7185').bold,
      mid: chalk.hex('#f43f5e'),
      back: chalk.hex('#9f1239'),
      glow: chalk.hex('#fda4af'),
      bg: chalk.hex('#31102f'),
    };
  }
  if (warm) {
    return {
      mood: 'ACTIVE',
      badgeColor: chalk.bgHex('#ff5500').black.bold,
      spec: chalk.hex('#fef08a').bold,
      front: chalk.hex('#fb923c').bold,
      mid: chalk.hex('#ea580c'),
      back: chalk.hex('#9a3412'),
      glow: chalk.hex('#fdba74'),
      bg: chalk.hex('#27171a'),
    };
  }
  return {
    mood: 'NOMINAL',
    badgeColor: chalk.bgHex('#06b6d4').black.bold,
    spec: chalk.hex('#e0f2fe').bold,
    front: chalk.hex('#38bdf8').bold,
    mid: chalk.hex('#0284c7'),
    back: chalk.hex('#0369a1'),
    glow: chalk.hex('#2dd4bf'),
    bg: chalk.hex('#17253b'),
  };
}

/**
 * 1. 3D Phong-Shaded Cyber Torus (Donut) using clean block-element shading
 */
function renderTorus3D(cols: number, rows: number, frame: number, telemetry: Sprite3DTelemetry): string[] {
  const pal = getReactivePalette(telemetry);
  const speedBoost = 1 + (telemetry.cpuUsage / 100) * 1.2;
  const A = 0.85 + frame * 0.14 * speedBoost;
  const B = 0.45 + frame * 0.09 * speedBoost;

  const cosA = Math.cos(A), sinA = Math.sin(A);
  const cosB = Math.cos(B), sinB = Math.sin(B);

  const zbuf = new Float32Array(cols * rows).fill(0);
  const lbuf = new Float32Array(cols * rows).fill(-1);

  const R1 = 0.85;
  const R2 = 1.75;
  const K2 = 5.4;
  const K1x = cols * K2 * 0.165;
  const K1y = rows * K2 * 0.31;

  for (let theta = 0; theta < Math.PI * 2; theta += 0.11) {
    const costheta = Math.cos(theta), sintheta = Math.sin(theta);
    for (let phi = 0; phi < Math.PI * 2; phi += 0.05) {
      const cosphi = Math.cos(phi), sinphi = Math.sin(phi);
      const circlex = R2 + R1 * costheta;
      const circley = R1 * sintheta;

      const x = circlex * (cosB * cosphi + sinA * sinB * sinphi) - circley * cosA * sinB;
      const y = circlex * (sinB * cosphi - sinA * cosB * sinphi) + circley * cosA * cosB;
      const z = K2 + cosA * circlex * sinphi + circley * sinA;
      const ooz = 1 / z;

      const xp = Math.floor(cols / 2 + K1x * ooz * x);
      const yp = Math.floor(rows / 2 - K1y * ooz * y);

      if (xp >= 0 && xp < cols && yp >= 0 && yp < rows) {
        const idx = yp * cols + xp;
        if (ooz > zbuf[idx]) {
          zbuf[idx] = ooz;
          const L =
            cosphi * costheta * sinB -
            cosA * costheta * sinphi -
            sinA * sintheta +
            cosB * (cosA * sintheta - costheta * sinA * sinphi);
          lbuf[idx] = Math.max(0, (L + 1.45) / 2.85);
        }
      }
    }
  }

  const torusRamp = ' ·░▒▓█';
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (zbuf[idx] === 0) {
        line += ' ';
      } else {
        const lum = lbuf[idx];
        const charIdx = Math.min(torusRamp.length - 1, Math.max(1, Math.floor(lum * (torusRamp.length - 1))));
        const ch = torusRamp[charIdx];
        if (lum > 0.78) line += pal.spec(ch);
        else if (lum > 0.52) line += pal.front(ch);
        else if (lum > 0.28) line += pal.mid(ch);
        else line += pal.back(ch);
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * 2. 4D -> 3D -> 2D Rotating Hypercube (Tesseract) in high-res Braille
 */
function renderTesseract4D(cols: number, rows: number, frame: number, telemetry: Sprite3DTelemetry): string[] {
  const pal = getReactivePalette(telemetry);
  const canvas = new BrailleCanvas3D(cols, rows);
  const t = frame * 0.12 + 0.5;

  // 16 vertices of a 4D hypercube: (±1, ±1, ±1, ±1)
  const verts4D: [number, number, number, number][] = [];
  for (let i = 0; i < 16; i++) {
    verts4D.push([
      i & 1 ? 1 : -1,
      i & 2 ? 1 : -1,
      i & 4 ? 1 : -1,
      i & 8 ? 1 : -1,
    ]);
  }

  const cosXW = Math.cos(t), sinXW = Math.sin(t);
  const cosYW = Math.cos(t * 0.7), sinYW = Math.sin(t * 0.7);
  const cosXY = Math.cos(t * 0.5), sinXY = Math.sin(t * 0.5);
  const cosXZ = Math.cos(0.45), sinXZ = Math.sin(0.45);

  const projected: { sx: number; sy: number; z: number }[] = [];
  const cx = canvas.subW / 2;
  const cy = canvas.subH / 2;
  const scaleX = canvas.subW * 0.28;
  const scaleY = canvas.subH * 0.28;

  for (const [vx, vy, vz, vw] of verts4D) {
    // Rotate in XW plane
    const x1 = vx * cosXW - vw * sinXW;
    const w1 = vx * sinXW + vw * cosXW;
    // Rotate in YW plane
    const y1 = vy * cosYW - w1 * sinYW;
    const w2 = vy * sinYW + w1 * cosYW;
    // Project 4D -> 3D
    const d4 = 2.6 / (2.6 - w2 * 0.75);
    const x3 = x1 * d4;
    const y3 = y1 * d4;
    const z3 = vz * d4;

    // Rotate 3D
    const rx = x3 * cosXY - y3 * sinXY;
    const ry = x3 * sinXY + y3 * cosXY;
    const rz = rx * sinXZ + z3 * cosXZ;
    const rx2 = rx * cosXZ - z3 * sinXZ;

    const d3 = 3.2 / (3.2 - rz * 0.5);
    projected.push({
      sx: cx + rx2 * d3 * scaleX * 0.55,
      sy: cy + ry * d3 * scaleY * 0.55,
      z: rz * 0.4,
    });
  }

  // Connect edges where Hamming distance == 1
  for (let i = 0; i < 16; i++) {
    for (let bit = 0; bit < 4; bit++) {
      const j = i ^ (1 << bit);
      if (i < j) {
        const p0 = projected[i];
        const p1 = projected[j];
        canvas.drawLine3D(p0.sx, p0.sy, p0.z, p1.sx, p1.sy, p1.z);
      }
    }
  }

  // Highlight front-most core center
  canvas.setGlyph(Math.floor(cols / 2), Math.floor(rows / 2), '◆', pal.spec, 2);
  return canvas.render(pal);
}

/**
 * 3. 3D Dual-Ring Gyro-Reactor Core + Rising Plasma Embers
 */
function renderReactor3D(cols: number, rows: number, frame: number, telemetry: Sprite3DTelemetry): string[] {
  const pal = getReactivePalette(telemetry);
  const canvas = new BrailleCanvas3D(cols, rows);
  const t = frame * 0.16 + 0.8;
  const cx = canvas.subW / 2;
  const cy = canvas.subH / 2;
  const rx = canvas.subW * 0.42;
  const ry = canvas.subH * 0.42;

  // Outer Gyro Ring 1
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const x = Math.cos(a);
    const y = Math.sin(a) * Math.cos(t);
    const z = Math.sin(a) * Math.sin(t);
    canvas.setSubPixel(cx + x * rx, cy + y * ry, z);
  }

  // Inner Gyro Ring 2 (orthogonal tilt)
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const x = Math.cos(a) * Math.cos(t * 0.8);
    const y = Math.sin(a);
    const z = Math.cos(a) * Math.sin(t * 0.8);
    canvas.setSubPixel(cx + x * rx * 0.78, cy + y * ry * 0.78, z);
  }

  // Inner Spinning 3D Octahedron Crystal
  const octVerts: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];
  const octEdges = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 4], [4, 3], [3, 5], [5, 2],
  ];
  const cosT = Math.cos(-t * 1.2), sinT = Math.sin(-t * 1.2);
  const projOct = octVerts.map(([vx, vy, vz]) => {
    const x1 = vx * cosT - vz * sinT;
    const z1 = vx * sinT + vz * cosT;
    return {
      sx: cx + x1 * rx * 0.52,
      sy: cy + vy * ry * 0.55,
      z: z1,
    };
  });
  for (const [i, j] of octEdges) {
    canvas.drawLine3D(projOct[i].sx, projOct[i].sy, projOct[i].z, projOct[j].sx, projOct[j].sy, projOct[j].z);
  }

  const midC = Math.floor(cols / 2);
  const midR = Math.floor(rows / 2);
  const coreGlyphs = ['◆', '◇', '●', '◉'];
  canvas.setGlyph(midC, midR, coreGlyphs[frame % coreGlyphs.length], pal.spec, 5);

  return canvas.render(pal);
}

/**
 * 4. Clean Pixel-Block Cyber Companion ("IGNIS")
 * Built from aligned solid block elements (▛ ▀ ▜, █, ▙ ▄ ▟) with a continuous
 * #0f172a visor fill so there are zero ragged gaps or stipple noise.
 */
function renderIgnisMascot3D(cols: number, rows: number, frame: number, telemetry: Sprite3DTelemetry): string[] {
  const pal = getReactivePalette(telemetry);
  const hot = telemetry.cpuUsage >= 75 || (telemetry.tempC !== undefined && telemetry.tempC >= 80);
  const warm = !hot && telemetry.cpuUsage >= 40;

  // Visor face (strictly 1-column characters inside a 7-column dark screen)
  let eyes = '◉ ‿ ◉';
  if (hot) {
    eyes = frame % 4 === 3 ? '─ _ ─' : '▲ _ ▲';
  } else if (warm) {
    eyes = frame % 6 === 5 ? '─ ‿ ─' : '◉ ‿ ◉';
  } else {
    const cycle = frame % 10;
    if (cycle === 8) eyes = '─ ‿ ─'; // Blink
    else if (cycle === 4) eyes = '● ‿ ●';
    else eyes = '◉ ‿ ◉';
  }

  const visorBg = chalk.bgHex('#0b1324');

  // Row 1 (9 cols): Solid top helmet rim — visorBg fills bottom half of ▛ ▀ ▜ so there are zero gaps
  const bevelTop =
    ' ' +
    visorBg(pal.front('▛') + pal.front('▀▀') + pal.spec('▀▀▀') + pal.front('▀▀') + pal.front('▜')) +
    ' ';

  // Row 2 (11 cols): Flush half-block ears (▐ / ▌) + solid side walls (█) + 7-col dark visor screen
  const earColor = frame % 2 === 0 ? pal.glow : pal.mid;
  const visorRow =
    earColor('▐') +
    visorBg(pal.front('█') + pal.spec.bold(` ${eyes} `) + pal.front('█')) +
    earColor('▌');

  // Row 3 (9 cols): Solid lower chin bezel — visorBg fills top half of ▙ ▄ ▟ so screen is a solid rectangle
  const coreLight = frame % 2 === 0 ? pal.spec('▄') : pal.glow('▄');
  const chinRow =
    ' ' +
    visorBg(pal.mid('▙') + pal.mid('▄▄') + pal.front('▄') + coreLight + pal.front('▄') + pal.mid('▄▄') + pal.mid('▟')) +
    ' ';

  // Row 4 (5 cols): Upper-half blocks (▝ ▀ █ ▀ ▘) connect flush to the bottom of Row 3's ▄ bezel
  const jetCenter = frame % 2 === 0 ? pal.spec('█') : pal.front('▀');
  const flame = `   ${pal.mid('▝')}${pal.front('▀')}${jetCenter}${pal.front('▀')}${pal.mid('▘')}   `;

  // Row 5 (7 cols): Clean hover shadow bar
  const pedestal = `  ${pal.back('══')}${pal.mid('═══')}${pal.back('══')}  `;

  // Row 6: Subtle status & key hint
  const label = chalk.hex('#64748b')(`${pal.mood} · [y]`);

  const rawRows = [
    bevelTop,
    visorRow,
    chinRow,
    flame,
    pedestal,
    label,
  ];

  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const spriteLine = rawRows[r] ?? '';
    const vLen = visLen(spriteLine);
    const leftPad = Math.max(0, Math.floor((cols - vLen) / 2));
    const rightPad = Math.max(0, cols - vLen - leftPad);
    out.push(fitVisible(' '.repeat(leftPad) + spriteLine + ' '.repeat(rightPad), cols));
  }
  return out;
}

/**
 * 5. Clean 3D Crystal Obelisk / Prism (solid geometry, no stipple clutter)
 */
function renderPrism3D(cols: number, rows: number, frame: number, telemetry: Sprite3DTelemetry): string[] {
  const pal = getReactivePalette(telemetry);
  const phase = frame % 4;
  const leftFacet = phase < 2 ? pal.spec : pal.mid;
  const rightFacet = phase < 2 ? pal.mid : pal.spec;

  const rawRows = [
    `    ${pal.spec('▲')}    `,
    `  ${pal.front('◢')}${leftFacet('██')}${pal.spec('│')}${rightFacet('██')}${pal.front('◣')}  `,
    ` ${pal.front('▐')}${leftFacet('███')}${pal.spec('◆')}${rightFacet('███')}${pal.front('▌')} `,
    `  ${pal.mid('◥')}${leftFacet('██')}${pal.front('│')}${rightFacet('██')}${pal.mid('◤')}  `,
    `  ${pal.back('══')}${pal.mid('═══')}${pal.back('══')}  `,
    chalk.hex('#64748b')('PRISM · [y]'),
  ];

  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const line = rawRows[r] ?? '';
    const vLen = visLen(line);
    const leftPad = Math.max(0, Math.floor((cols - vLen) / 2));
    const rightPad = Math.max(0, cols - vLen - leftPad);
    out.push(fitVisible(' '.repeat(leftPad) + line + ' '.repeat(rightPad), cols));
  }
  return out;
}

/**
 * Render a 3D Animated Holo-Sprite Viewport of exact dimensions `cols x rows`.
 */
export function render3DSprite(
  mode: Sprite3DMode,
  cols: number,
  rows: number,
  frame = 14,
  telemetry: Sprite3DTelemetry = { cpuUsage: 25, memUsage: 50 }
): string[] {
  const w = Math.max(10, cols);
  const h = Math.max(4, rows);
  switch (mode) {
    case 'torus':
      return renderTorus3D(w, h, frame, telemetry);
    case 'tesseract':
      return renderTesseract4D(w, h, frame, telemetry);
    case 'reactor':
      return renderReactor3D(w, h, frame, telemetry);
    case 'prism':
      return renderPrism3D(w, h, frame, telemetry);
    case 'ignis':
    default:
      return renderIgnisMascot3D(w, h, frame, telemetry);
  }
}

/**
 * Return a compact 1-line animated 3D cyber-visor badge for headers/status bars.
 */
export function renderMiniCyberVisor(frame: number, cpuUsage: number, tempC?: number): string {
  const hot = cpuUsage >= 75 || (tempC !== undefined && tempC >= 80);
  const warm = !hot && cpuUsage >= 40;
  if (hot) {
    return chalk.bgHex('#4c0519').hex('#fb7185').bold(' [▲_▲] OVERDRIVE ');
  }
  if (warm) {
    return chalk.bgHex('#431407').hex('#fb923c').bold(' [◆‿◆] ACTIVE ');
  }
  const eyes = frame % 8 === 6 ? '─‿─' : '◉‿◉';
  return chalk.bgHex('#0f172a').hex('#38bdf8').bold(` [${eyes}] NOMINAL `);
}
