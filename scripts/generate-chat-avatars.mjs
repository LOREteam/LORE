import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "chat-avatars");
const SOURCE_SIZE = 768;
const OUTPUT_SIZE = 640;
const SCALE = SOURCE_SIZE / 640;

const THEMES = {
  violet: {
    glow: "#7c3aed",
    glowSoft: "#d8b4fe",
    shellTop: "#171626",
    shellBottom: "#070913",
    ringLight: "#f5eaff",
    ringMid: "#9567ff",
    panelTop: "#1a1730",
    panelBottom: "#090b15",
    accentA: "#eadcff",
    accentB: "#7d4dff",
    metalA: "#f8f5ff",
    metalB: "#707b97",
    ember: "#fff2c7",
  },
  amber: {
    glow: "#f59e0b",
    glowSoft: "#fde68a",
    shellTop: "#24190e",
    shellBottom: "#0a0b12",
    ringLight: "#fff3c3",
    ringMid: "#ffb02d",
    panelTop: "#251b12",
    panelBottom: "#0b0d14",
    accentA: "#ffe2a4",
    accentB: "#cf7a10",
    metalA: "#fff5d6",
    metalB: "#786c57",
    ember: "#fff6c6",
  },
  emerald: {
    glow: "#22c55e",
    glowSoft: "#a7f3d0",
    shellTop: "#0f1d22",
    shellBottom: "#080b12",
    ringLight: "#dcfff7",
    ringMid: "#59caff",
    panelTop: "#10222a",
    panelBottom: "#0a0d14",
    accentA: "#c2fbff",
    accentB: "#1cb9b0",
    metalA: "#f2ffff",
    metalB: "#6f8397",
    ember: "#f1fff7",
  },
  steel: {
    glow: "#94a3b8",
    glowSoft: "#e2e8f0",
    shellTop: "#181c24",
    shellBottom: "#090b12",
    ringLight: "#f6f9ff",
    ringMid: "#94a3b8",
    panelTop: "#171d29",
    panelBottom: "#0a0d14",
    accentA: "#edf2f7",
    accentB: "#66758a",
    metalA: "#ffffff",
    metalB: "#7b8898",
    ember: "#f8fbff",
  },
};

const AVATARS = {
  "miner-helmet": { theme: "violet", draw: drawMinerHelmet },
  "crossed-picks": { theme: "amber", draw: drawCrossedPicks },
  "crystal-cluster": { theme: "violet", draw: drawCrystalCluster },
  "mine-cart": { theme: "emerald", draw: drawMineCart },
  dynamite: { theme: "amber", draw: drawDynamite },
  "gold-ingot": { theme: "amber", draw: drawGoldIngot },
  "wall-torch": { theme: "violet", draw: drawWallTorch },
  "drill-bit": { theme: "emerald", draw: drawDrillBit },
  "mega-diamond": { theme: "violet", draw: drawMegaDiamond },
  "fire-gem": { theme: "amber", draw: drawFireGem },
  "shield-pick": { theme: "emerald", draw: drawShieldPick },
  potion: { theme: "emerald", draw: drawPotion },
  "dragon-eye": { theme: "violet", draw: drawDragonEye },
  "crown-gems": { theme: "violet", draw: drawCrownGems },
  skull: { theme: "steel", draw: drawSkull },
  "lantern-glow": { theme: "amber", draw: drawLanternGlow },
};

function px(value) {
  return value * SCALE;
}

function hexToRgba(hex, alpha = 1) {
  const value = hex.replace("#", "");
  const size = value.length === 3 ? 1 : 2;
  const read = (index) => {
    const part = size === 1 ? value[index] + value[index] : value.slice(index * 2, index * 2 + 2);
    return Number.parseInt(part, 16);
  };
  return { r: read(0), g: read(1), b: read(2), a: alpha };
}

function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

class Surface {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  blendPixel(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    const sa = Math.max(0, Math.min(1, color.a));
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    this.data[i] = Math.round((color.r * sa + this.data[i] * da * (1 - sa)) / outA);
    this.data[i + 1] = Math.round((color.g * sa + this.data[i + 1] * da * (1 - sa)) / outA);
    this.data[i + 2] = Math.round((color.b * sa + this.data[i + 2] * da * (1 - sa)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x, y, w, h, color) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) this.blendPixel(xx, yy, color);
    }
  }

  fillCircle(cx, cy, radius, sampler) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const t = dist / radius;
        const color = sampler(t, x, y);
        if (color) this.blendPixel(x, y, color);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, sampler) {
    const x0 = Math.max(0, Math.floor(cx - rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const color = sampler(Math.sqrt(d), x, y);
        if (color) this.blendPixel(x, y, color);
      }
    }
  }

  fillPolygon(points, sampler) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!pointInPolygon(x + 0.5, y + 0.5, points)) continue;
        const color = sampler(x, y);
        if (color) this.blendPixel(x, y, color);
      }
    }
  }

  strokePolygon(points, width, color) {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      this.strokeLine(a.x, a.y, b.x, b.y, width, color);
    }
  }

  strokeLine(x1, y1, x2, y2, width, color) {
    const pad = width + 2;
    const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - pad));
    const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - pad));
    const x3 = Math.min(this.width - 1, Math.ceil(Math.max(x1, x2) + pad));
    const y3 = Math.min(this.height - 1, Math.ceil(Math.max(y1, y2) + pad));
    for (let y = y0; y <= y3; y += 1) {
      for (let x = x0; x <= x3; x += 1) {
        const d = distanceToSegment(x + 0.5, y + 0.5, x1, y1, x2, y2);
        if (d > width / 2) continue;
        const a = 1 - d / (width / 2);
        this.blendPixel(x, y, { ...color, a: color.a * a });
      }
    }
  }
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px0, py0, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px0 - x1) * dx + (py0 - y1) * dy) / len2));
  const sx = x1 + t * dx;
  const sy = y1 + t * dy;
  const ddx = px0 - sx;
  const ddy = py0 - sy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

function hexPoints(cx, cy, radius) {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

function offsetPoints(points, dx, dy) {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function drawGradientPoly(surface, points, c1, c2, vertical = true, alpha = 1) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  surface.fillPolygon(points, (x, y) => {
    const t = vertical ? (y - minY) / Math.max(1, maxY - minY) : (x - minX) / Math.max(1, maxX - minX);
    const color = mix(c1, c2, Math.max(0, Math.min(1, t)));
    return { ...color, a: color.a * alpha };
  });
}

function drawBadge(surface, themeName) {
  const t = THEMES[themeName];
  const shadow = hexToRgba("#02040a", 0.48);
  const glow = hexToRgba(t.glow, 0.18);
  const ringLight = hexToRgba(t.ringLight, 0.94);
  const ringMid = hexToRgba(t.ringMid, 0.92);
  const shellTop = hexToRgba(t.shellTop, 1);
  const shellBottom = hexToRgba(t.shellBottom, 1);
  const panelTop = hexToRgba(t.panelTop, 1);
  const panelBottom = hexToRgba(t.panelBottom, 1);

  surface.fillEllipse(px(320), px(548), px(156), px(42), (d) => ({ ...shadow, a: shadow.a * (1 - d) }));
  surface.fillCircle(px(320), px(320), px(216), (d) => ({ ...glow, a: glow.a * (1 - d) * (1 - d) }));

  const outer = hexPoints(px(320), px(320), px(232));
  const rim = hexPoints(px(320), px(320), px(214));
  const inner = hexPoints(px(320), px(320), px(188));
  const inset = hexPoints(px(320), px(320), px(156));

  drawGradientPoly(surface, outer, shellTop, shellBottom);
  drawGradientPoly(surface, rim, ringLight, ringMid);
  drawGradientPoly(surface, inner, panelTop, panelBottom);
  surface.strokePolygon(inner, px(4), hexToRgba("#ffffff", 0.08));
  drawGradientPoly(surface, inset, hexToRgba("#111522", 0.4), hexToRgba("#070912", 0.4));
  surface.strokePolygon(inset, px(3), hexToRgba("#ffffff", 0.05));
  surface.fillCircle(px(320), px(302), px(136), (d) => ({ ...hexToRgba(t.glowSoft, 0.14), a: 0.14 * (1 - d) * (1 - d) }));
  surface.fillEllipse(px(320), px(210), px(124), px(34), (d) => ({ ...hexToRgba("#ffffff", 0.07), a: 0.07 * (1 - d) }));
  surface.strokeLine(px(214), px(206), px(428), px(206), px(4), hexToRgba("#ffffff", 0.06));
  surface.strokeLine(px(182), px(184), px(450), px(184), px(2), hexToRgba("#ffffff", 0.04));
  surface.fillCircle(px(174), px(184), px(6), () => hexToRgba(t.glowSoft, 0.55));
  surface.fillCircle(px(468), px(178), px(5), () => hexToRgba(t.glowSoft, 0.48));
  surface.fillCircle(px(160), px(446), px(4), () => hexToRgba(t.glowSoft, 0.42));
  surface.strokeLine(px(420), px(228), px(458), px(212), px(2), hexToRgba("#ffffff", 0.08));
  surface.strokeLine(px(204), px(412), px(236), px(430), px(2), hexToRgba("#ffffff", 0.06));
  surface.strokeLine(px(256), px(236), px(284), px(232), px(2), hexToRgba("#ffffff", 0.05));
  addNoise(surface, inner, t.glowSoft);
}

function addNoise(surface, maskPoints, hex) {
  const color = hexToRgba(hex, 0.045);
  const xs = maskPoints.map((p) => p.x);
  const ys = maskPoints.map((p) => p.y);
  const minX = Math.floor(Math.min(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxX = Math.ceil(Math.max(...xs));
  const maxY = Math.ceil(Math.max(...ys));
  for (let i = 0; i < 1200; i += 1) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (!pointInPolygon(x, y, maskPoints)) continue;
    surface.blendPixel(x, y, { ...color, a: color.a * Math.random() });
  }
}

function addSpark(surface, cx, cy, size, color) {
  surface.strokeLine(cx - size, cy, cx + size, cy, px(5), color);
  surface.strokeLine(cx, cy - size, cx, cy + size, px(5), color);
  surface.strokeLine(cx - size * 0.72, cy - size * 0.72, cx + size * 0.72, cy + size * 0.72, px(4), { ...color, a: color.a * 0.9 });
  surface.strokeLine(cx + size * 0.72, cy - size * 0.72, cx - size * 0.72, cy + size * 0.72, px(4), { ...color, a: color.a * 0.9 });
}

function drawMetalStroke(surface, points, width, theme) {
  surface.strokePolygon(points, width, hexToRgba(theme.metalA, 0.8));
  surface.strokePolygon(points, Math.max(1, width / 2.2), hexToRgba(theme.metalB, 0.72));
}

function drawGem(surface, points, theme, glowStrength = 0.2) {
  surface.fillPolygon(offsetPoints(points, px(5), px(7)), () => hexToRgba("#02040a", 0.22));
  drawGradientPoly(surface, points, hexToRgba(theme.accentA, 1), hexToRgba(theme.accentB, 1));
  drawMetalStroke(surface, points, px(5), theme);
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  surface.fillCircle(cx, cy, px(34), (d) => ({ ...hexToRgba(theme.ember, glowStrength), a: glowStrength * (1 - d) * (1 - d) }));
}

function drawMinerHelmet(surface, theme) {
  const hood = [
    { x: px(246), y: px(214) }, { x: px(320), y: px(168) }, { x: px(392), y: px(214) },
    { x: px(418), y: px(292) }, { x: px(394), y: px(440) }, { x: px(246), y: px(440) }, { x: px(222), y: px(292) },
  ];
  drawGradientPoly(surface, hood, hexToRgba("#30254a", 1), hexToRgba("#0b0f1a", 1));
  drawMetalStroke(surface, hood, px(8), theme);
  const face = [
    { x: px(272), y: px(274) }, { x: px(368), y: px(274) }, { x: px(380), y: px(382) },
    { x: px(260), y: px(382) },
  ];
  drawGradientPoly(surface, face, hexToRgba("#060912", 1), hexToRgba("#0b1020", 1));
  const eyeL = { x: px(286), y: px(332) };
  const eyeR = { x: px(354), y: px(332) };
  surface.fillEllipse(eyeL.x, eyeL.y, px(28), px(18), (d) => ({ ...hexToRgba(theme.ember, 0.92), a: 0.92 * (1 - d * 0.6) }));
  surface.fillEllipse(eyeR.x, eyeR.y, px(28), px(18), (d) => ({ ...hexToRgba(theme.ember, 0.92), a: 0.92 * (1 - d * 0.6) }));
  surface.fillEllipse(eyeL.x, eyeL.y - px(2), px(10), px(7), () => hexToRgba("#fffdf2", 0.94));
  surface.fillEllipse(eyeR.x, eyeR.y - px(2), px(10), px(7), () => hexToRgba("#fffdf2", 0.94));
  const gem = [{ x: px(320), y: px(392) }, { x: px(342), y: px(418) }, { x: px(320), y: px(452) }, { x: px(298), y: px(418) }];
  drawGem(surface, gem, theme, 0.28);
}

function drawCrossedPicks(surface, theme) {
  const handle1 = [{ x: px(244), y: px(224) }, { x: px(272), y: px(206) }, { x: px(404), y: px(392) }, { x: px(382), y: px(420) }];
  const handle2 = [{ x: px(396), y: px(224) }, { x: px(368), y: px(206) }, { x: px(236), y: px(392) }, { x: px(258), y: px(420) }];
  drawGradientPoly(surface, handle1, hexToRgba("#2e2637", 1), hexToRgba("#171a26", 1), false);
  drawGradientPoly(surface, handle2, hexToRgba("#2e2637", 1), hexToRgba("#171a26", 1), false);
  drawMetalStroke(surface, handle1, px(6), theme);
  drawMetalStroke(surface, handle2, px(6), theme);
  const head1 = [{ x: px(202), y: px(244) }, { x: px(246), y: px(208) }, { x: px(320), y: px(222) }, { x: px(288), y: px(284) }, { x: px(228), y: px(284) }];
  const head2 = [{ x: px(438), y: px(244) }, { x: px(394), y: px(208) }, { x: px(320), y: px(222) }, { x: px(352), y: px(284) }, { x: px(412), y: px(284) }];
  drawGradientPoly(surface, head1, hexToRgba(theme.accentA, 1), hexToRgba(theme.accentB, 1), false);
  drawGradientPoly(surface, head2, hexToRgba(theme.accentA, 0.92), hexToRgba(theme.accentB, 0.92), false);
  drawMetalStroke(surface, head1, px(5), theme);
  drawMetalStroke(surface, head2, px(5), theme);
  const core = [{ x: px(320), y: px(268) }, { x: px(340), y: px(288) }, { x: px(320), y: px(308) }, { x: px(300), y: px(288) }];
  drawGem(surface, core, theme, 0.24);
}

function drawCrystalCluster(surface, theme) {
  const c1 = [{ x: px(250), y: px(434) }, { x: px(230), y: px(302) }, { x: px(284), y: px(214) }, { x: px(338), y: px(264) }, { x: px(318), y: px(434) }];
  const c2 = [{ x: px(314), y: px(462) }, { x: px(286), y: px(286) }, { x: px(354), y: px(188) }, { x: px(438), y: px(266) }, { x: px(410), y: px(462) }];
  const c3 = [{ x: px(406), y: px(414) }, { x: px(388), y: px(296) }, { x: px(438), y: px(234) }, { x: px(482), y: px(282) }, { x: px(462), y: px(414) }];
  drawGem(surface, c1, theme, 0.14);
  drawGem(surface, c2, theme, 0.24);
  drawGem(surface, c3, theme, 0.12);
  surface.strokeLine(px(286), px(286), px(352), px(190), px(3), hexToRgba("#ffffff", 0.26));
  surface.strokeLine(px(354), px(188), px(438), px(266), px(3), hexToRgba("#ffffff", 0.22));
}

function drawMineCart(surface, theme) {
  const body = [{ x: px(216), y: px(352) }, { x: px(430), y: px(352) }, { x: px(402), y: px(430) }, { x: px(244), y: px(430) }];
  drawGradientPoly(surface, body, hexToRgba("#182330", 1), hexToRgba("#0b1018", 1));
  drawMetalStroke(surface, body, px(7), theme);
  surface.strokeLine(px(240), px(372), px(406), px(372), px(5), hexToRgba(theme.metalB, 0.72));
  surface.strokeLine(px(236), px(398), px(398), px(398), px(4), hexToRgba(theme.metalB, 0.62));
  const ore1 = [{ x: px(246), y: px(336) }, { x: px(276), y: px(280) }, { x: px(328), y: px(314) }, { x: px(304), y: px(352) }];
  const ore2 = [{ x: px(302), y: px(334) }, { x: px(340), y: px(266) }, { x: px(386), y: px(314) }, { x: px(356), y: px(352) }];
  const ore3 = [{ x: px(360), y: px(340) }, { x: px(398), y: px(290) }, { x: px(434), y: px(330) }, { x: px(410), y: px(358) }];
  drawGem(surface, ore1, theme, 0.18);
  drawGem(surface, ore2, theme, 0.22);
  drawGem(surface, ore3, theme, 0.14);
  surface.fillCircle(px(256), px(446), px(34), (d) => ({ ...hexToRgba("#09111c", 1), a: 1 - d * 0.15 }));
  surface.fillCircle(px(388), px(446), px(34), (d) => ({ ...hexToRgba("#09111c", 1), a: 1 - d * 0.15 }));
  surface.fillCircle(px(256), px(446), px(14), () => hexToRgba(theme.accentA, 0.85));
  surface.fillCircle(px(388), px(446), px(14), () => hexToRgba(theme.accentA, 0.85));
}

function drawDynamite(surface, theme) {
  const sticks = [
    { x: px(232), y: px(252), w: px(50), h: px(176) },
    { x: px(294), y: px(236), w: px(52), h: px(192) },
    { x: px(360), y: px(252), w: px(50), h: px(176) },
  ];
  for (const stick of sticks) {
    surface.fillRect(stick.x, stick.y, stick.w, stick.h, hexToRgba("#5d1115", 1));
    surface.strokeLine(stick.x, stick.y, stick.x + stick.w, stick.y, px(5), hexToRgba(theme.metalA, 0.7));
    surface.strokeLine(stick.x, stick.y + stick.h, stick.x + stick.w, stick.y + stick.h, px(5), hexToRgba(theme.metalB, 0.62));
    surface.strokeLine(stick.x, stick.y, stick.x, stick.y + stick.h, px(5), hexToRgba(theme.metalB, 0.55));
    surface.strokeLine(stick.x + stick.w, stick.y, stick.x + stick.w, stick.y + stick.h, px(5), hexToRgba(theme.metalA, 0.34));
  }
  surface.strokeLine(px(256), px(248), px(316), px(216), px(6), hexToRgba("#fbbf24", 0.8));
  surface.strokeLine(px(320), px(236), px(394), px(200), px(6), hexToRgba("#fbbf24", 0.86));
  surface.strokeLine(px(388), px(248), px(430), px(226), px(6), hexToRgba("#fbbf24", 0.76));
  addSpark(surface, px(426), px(194), px(18), hexToRgba(theme.ember, 0.92));
}

function drawGoldIngot(surface, theme) {
  const front = [{ x: px(228), y: px(394) }, { x: px(458), y: px(394) }, { x: px(426), y: px(456) }, { x: px(202), y: px(456) }];
  const top = [{ x: px(248), y: px(336) }, { x: px(420), y: px(336) }, { x: px(458), y: px(394) }, { x: px(228), y: px(394) }];
  const left = [{ x: px(202), y: px(456) }, { x: px(228), y: px(394) }, { x: px(248), y: px(336) }, { x: px(218), y: px(392) }];
  drawGradientPoly(surface, front, hexToRgba(theme.accentB, 1), hexToRgba("#5f3606", 1));
  drawGradientPoly(surface, top, hexToRgba(theme.accentA, 1), hexToRgba(theme.accentB, 1));
  drawGradientPoly(surface, left, hexToRgba("#b86a0f", 1), hexToRgba("#5f3606", 1));
  drawMetalStroke(surface, front, px(5), theme);
  drawMetalStroke(surface, top, px(5), theme);
  drawMetalStroke(surface, left, px(5), theme);
  const small1 = [{ x: px(180), y: px(420) }, { x: px(260), y: px(420) }, { x: px(238), y: px(468) }, { x: px(156), y: px(468) }];
  drawGradientPoly(surface, small1, hexToRgba(theme.accentA, 0.95), hexToRgba(theme.accentB, 0.95));
  drawMetalStroke(surface, small1, px(4), theme);
  const small2 = [{ x: px(340), y: px(454) }, { x: px(446), y: px(454) }, { x: px(424), y: px(500) }, { x: px(318), y: px(500) }];
  drawGradientPoly(surface, small2, hexToRgba(theme.accentA, 0.92), hexToRgba(theme.accentB, 0.92));
  drawMetalStroke(surface, small2, px(4), theme);
}

function drawWallTorch(surface, theme) {
  const holder = [{ x: px(286), y: px(290) }, { x: px(354), y: px(290) }, { x: px(340), y: px(410) }, { x: px(300), y: px(410) }];
  drawGradientPoly(surface, holder, hexToRgba("#201711", 1), hexToRgba("#0b0d14", 1));
  drawMetalStroke(surface, holder, px(6), theme);
  const crystal = [{ x: px(320), y: px(188) }, { x: px(348), y: px(220) }, { x: px(330), y: px(292) }, { x: px(310), y: px(292) }, { x: px(292), y: px(220) }];
  drawGem(surface, crystal, theme, 0.32);
  const cradle = [{ x: px(270), y: px(284) }, { x: px(370), y: px(284) }, { x: px(346), y: px(330) }, { x: px(294), y: px(330) }];
  drawGradientPoly(surface, cradle, hexToRgba("#101622", 1), hexToRgba("#060913", 1));
  drawMetalStroke(surface, cradle, px(5), theme);
}

function drawDrillBit(surface, theme) {
  const bit = [
    { x: px(320), y: px(188) }, { x: px(384), y: px(246) }, { x: px(360), y: px(278) }, { x: px(400), y: px(314) },
    { x: px(366), y: px(352) }, { x: px(402), y: px(390) }, { x: px(350), y: px(448) }, { x: px(320), y: px(416) },
    { x: px(290), y: px(448) }, { x: px(238), y: px(390) }, { x: px(274), y: px(352) }, { x: px(240), y: px(314) },
    { x: px(280), y: px(278) }, { x: px(256), y: px(246) },
  ];
  drawGradientPoly(surface, bit, hexToRgba(theme.accentA, 1), hexToRgba(theme.accentB, 1));
  drawMetalStroke(surface, bit, px(6), theme);
  surface.strokeLine(px(320), px(188), px(320), px(416), px(4), hexToRgba("#ffffff", 0.28));
  surface.strokeLine(px(256), px(246), px(384), px(246), px(4), hexToRgba("#ffffff", 0.18));
  surface.strokeLine(px(240), px(314), px(400), px(314), px(4), hexToRgba("#ffffff", 0.18));
}

function drawMegaDiamond(surface, theme) {
  const gem = [{ x: px(320), y: px(170) }, { x: px(414), y: px(262) }, { x: px(320), y: px(448) }, { x: px(226), y: px(262) }];
  drawGem(surface, gem, theme, 0.32);
  surface.strokeLine(px(320), px(170), px(320), px(448), px(4), hexToRgba("#ffffff", 0.35));
  surface.strokeLine(px(226), px(262), px(414), px(262), px(4), hexToRgba("#ffffff", 0.25));
  surface.strokeLine(px(278), px(216), px(362), px(216), px(4), hexToRgba("#ffffff", 0.22));
  surface.strokeLine(px(262), px(352), px(378), px(262), px(4), hexToRgba("#ffffff", 0.18));
}

function drawFireGem(surface, theme) {
  const gem = [{ x: px(320), y: px(188) }, { x: px(404), y: px(252) }, { x: px(378), y: px(384) }, { x: px(320), y: px(460) }, { x: px(262), y: px(384) }, { x: px(236), y: px(252) }];
  drawGem(surface, gem, theme, 0.26);
  const flame = [{ x: px(320), y: px(252) }, { x: px(350), y: px(318) }, { x: px(334), y: px(392) }, { x: px(320), y: px(420) }, { x: px(306), y: px(392) }, { x: px(290), y: px(318) }];
  drawGradientPoly(surface, flame, hexToRgba("#fff6cc", 0.95), hexToRgba(theme.accentB, 0.95));
  surface.fillCircle(px(320), px(330), px(74), (d) => ({ ...hexToRgba(theme.ember, 0.24), a: 0.24 * (1 - d) * (1 - d) }));
}

function drawShieldPick(surface, theme) {
  const shield = [{ x: px(320), y: px(188) }, { x: px(410), y: px(228) }, { x: px(410), y: px(352) }, { x: px(320), y: px(460) }, { x: px(230), y: px(352) }, { x: px(230), y: px(228) }];
  drawGradientPoly(surface, shield, hexToRgba("#111827", 1), hexToRgba(theme.accentB, 0.9));
  drawMetalStroke(surface, shield, px(7), theme);
  const emblem = [{ x: px(286), y: px(330) }, { x: px(320), y: px(278) }, { x: px(354), y: px(330) }, { x: px(330), y: px(372) }, { x: px(310), y: px(372) }];
  drawGradientPoly(surface, emblem, hexToRgba(theme.ember, 1), hexToRgba(theme.accentA, 0.92));
  surface.strokeLine(px(270), px(342), px(370), px(242), px(6), hexToRgba(theme.metalA, 0.64));
  surface.strokeLine(px(320), px(278), px(320), px(392), px(5), hexToRgba(theme.metalA, 0.5));
}

function drawPotion(surface, theme) {
  const bottle = [
    { x: px(296), y: px(204) }, { x: px(344), y: px(204) }, { x: px(344), y: px(264) }, { x: px(388), y: px(342) },
    { x: px(366), y: px(440) }, { x: px(274), y: px(440) }, { x: px(252), y: px(342) }, { x: px(296), y: px(264) },
  ];
  drawGradientPoly(surface, bottle, hexToRgba("#12192a", 1), hexToRgba("#070b12", 1));
  drawMetalStroke(surface, bottle, px(7), theme);
  surface.fillEllipse(px(320), px(368), px(72), px(64), (d) => ({ ...hexToRgba(theme.accentA, 0.82), a: 0.82 * (1 - d * 0.2) }));
  surface.fillEllipse(px(320), px(356), px(82), px(22), (d) => ({ ...hexToRgba("#ffffff", 0.16), a: 0.16 * (1 - d) }));
  surface.fillCircle(px(298), px(372), px(8), () => hexToRgba(theme.ember, 0.9));
  surface.fillCircle(px(340), px(390), px(6), () => hexToRgba(theme.ember, 0.76));
}

function drawDragonEye(surface, theme) {
  const eye = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = px(180 + 280 * t);
    const offset = Math.sin(t * Math.PI) * px(96);
    eye.push({ x, y: px(320) - offset });
  }
  for (let i = 24; i >= 0; i -= 1) {
    const t = i / 24;
    const x = px(180 + 280 * t);
    const offset = Math.sin(t * Math.PI) * px(96);
    eye.push({ x, y: px(320) + offset });
  }
  drawGradientPoly(surface, eye, hexToRgba("#0a0f18", 1), hexToRgba(theme.accentB, 0.92), false);
  drawMetalStroke(surface, eye, px(7), theme);
  surface.fillEllipse(px(320), px(320), px(62), px(86), (d) => ({ ...hexToRgba(theme.ember, 0.95), a: 0.95 * (1 - d * 0.1) }));
  const pupil = [{ x: px(320), y: px(240) }, { x: px(334), y: px(320) }, { x: px(320), y: px(400) }, { x: px(306), y: px(320) }];
  drawGradientPoly(surface, pupil, hexToRgba("#0a0b10", 1), hexToRgba("#111318", 1));
}

function drawCrownGems(surface, theme) {
  const crown = [{ x: px(208), y: px(426) }, { x: px(234), y: px(318) }, { x: px(286), y: px(362) }, { x: px(320), y: px(266) }, { x: px(354), y: px(362) }, { x: px(406), y: px(318) }, { x: px(432), y: px(426) }];
  drawGradientPoly(surface, crown, hexToRgba("#15192b", 1), hexToRgba(theme.accentB, 0.94));
  drawMetalStroke(surface, crown, px(7), theme);
  surface.fillRect(px(228), px(398), px(184), px(34), hexToRgba(theme.accentB, 0.92));
  surface.strokeLine(px(228), px(398), px(412), px(398), px(5), hexToRgba(theme.metalA, 0.52));
  drawGem(surface, [{ x: px(286), y: px(392) }, { x: px(302), y: px(412) }, { x: px(286), y: px(430) }, { x: px(270), y: px(412) }], theme, 0.18);
  drawGem(surface, [{ x: px(354), y: px(374) }, { x: px(370), y: px(392) }, { x: px(354), y: px(412) }, { x: px(338), y: px(392) }], theme, 0.18);
}

function drawSkull(surface, theme) {
  surface.fillCircle(px(320), px(306), px(116), (d) => ({ ...hexToRgba(theme.accentB, 0.9), a: 0.9 * (1 - d * 0.1) }));
  const jaw = [{ x: px(248), y: px(338) }, { x: px(392), y: px(338) }, { x: px(382), y: px(454) }, { x: px(258), y: px(454) }];
  drawGradientPoly(surface, jaw, hexToRgba(theme.accentA, 0.95), hexToRgba(theme.accentB, 0.95));
  surface.fillCircle(px(286), px(318), px(34), () => hexToRgba("#0a0d14", 1));
  surface.fillCircle(px(354), px(318), px(34), () => hexToRgba("#0a0d14", 1));
  const nose = [{ x: px(320), y: px(346) }, { x: px(340), y: px(384) }, { x: px(300), y: px(384) }];
  drawGradientPoly(surface, nose, hexToRgba("#0a0d14", 1), hexToRgba("#111827", 1));
  for (let i = 0; i < 5; i += 1) surface.fillRect(px(274 + i * 22), px(418), px(10), px(28), hexToRgba("#0a0d14", 0.88));
  surface.strokeLine(px(248), px(338), px(392), px(338), px(5), hexToRgba(theme.metalA, 0.3));
}

function drawLanternGlow(surface, theme) {
  const body = [
    { x: px(286), y: px(198) }, { x: px(354), y: px(198) }, { x: px(386), y: px(252) }, { x: px(386), y: px(404) },
    { x: px(320), y: px(462) }, { x: px(254), y: px(404) }, { x: px(254), y: px(252) },
  ];
  drawGradientPoly(surface, body, hexToRgba("#12192b", 1), hexToRgba("#090b14", 1));
  drawMetalStroke(surface, body, px(7), theme);
  surface.strokeLine(px(286), px(198), px(354), px(198), px(6), hexToRgba(theme.metalA, 0.48));
  surface.fillCircle(px(320), px(332), px(78), (d) => ({ ...hexToRgba(theme.ember, 0.34), a: 0.34 * (1 - d) * (1 - d) }));
  const crystal = [{ x: px(320), y: px(262) }, { x: px(342), y: px(304) }, { x: px(320), y: px(382) }, { x: px(298), y: px(304) }];
  drawGradientPoly(surface, crystal, hexToRgba(theme.ember, 1), hexToRgba(theme.accentB, 0.98));
  surface.fillRect(px(298), px(176), px(44), px(22), hexToRgba("#46301b", 1));
}

async function renderAvatar(id, config) {
  const surface = new Surface(SOURCE_SIZE, SOURCE_SIZE);
  drawBadge(surface, config.theme);
  config.draw(surface, THEMES[config.theme]);

  await sharp(surface.data, {
    raw: { width: SOURCE_SIZE, height: SOURCE_SIZE, channels: 4 },
  })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "contain", kernel: "lanczos3" })
    .sharpen({ sigma: 1.1, m1: 0.8, m2: 1.4, x1: 2, y2: 10, y3: 18 })
    .png()
    .toFile(path.join(OUT_DIR, `${id}.png`));
}

await mkdir(OUT_DIR, { recursive: true });
for (const [id, config] of Object.entries(AVATARS)) {
  await renderAvatar(id, config);
  console.log(path.join(OUT_DIR, `${id}.png`));
}
