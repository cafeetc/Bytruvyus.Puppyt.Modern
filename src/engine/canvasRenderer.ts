import { getPieceWorldMatrix, getTensionRatio, mkCanvas, parentOf, pos, samplePieceWorldMask, solveRig } from './fkEngine';
import type { AbcPoseRecord, AbcSlot, RenderMode, RigNode, RigPiece } from './types';

const GREEN = '#22c55e';
const RED = '#ef4444';
const MAGENTA = '#ff3b6b';
const PURPLE_GUIDE = 'rgba(168, 85, 247, 0.72)';
const PURPLE_GUIDE_TEXT = 'rgba(192, 132, 252, 0.92)';
const SK: Array<[number, number]> = [
  [1006, 140],
  [1511, 140],
  [1259, 890],
];

const ABC_TINT: Record<AbcSlot, { fill: string; stroke: string; badge: string }> = {
  A: { fill: 'rgba(168, 85, 247, 0.36)', stroke: 'rgba(192, 132, 252, 0.88)', badge: '#c084fc' },
  B: { fill: 'rgba(16, 185, 129, 0.34)', stroke: 'rgba(52, 211, 153, 0.88)', badge: '#34d399' },
  C: { fill: 'rgba(255, 59, 107, 0.34)', stroke: 'rgba(255, 107, 143, 0.88)', badge: '#ff6b8f' },
  D: { fill: 'rgba(251, 191, 36, 0.32)', stroke: 'rgba(251, 191, 36, 0.88)', badge: '#fbbf24' },
  E: { fill: 'rgba(56, 189, 248, 0.32)', stroke: 'rgba(56, 189, 248, 0.88)', badge: '#38bdf8' },
};

export interface AbcGhostItem {
  slot: AbcSlot;
  pose: AbcPoseRecord;
  isPrimary: boolean;
  opacity: number;
}

export interface RenderContextState {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nodes: RigNode[];
  by: Record<string, RigNode>;
  pieces: RigPiece[];
  sel: RigNode | null;
  hov: RigNode | null;
  W: number;
  H: number;
  z: number;
  ox: number;
  oy: number;
  dpr: number;
  mode: RenderMode;
  showBones: boolean;
  showGuides: boolean;
  constrainLimits: boolean;
  bondOn?: boolean;
  isActiveMotion: boolean;
  actUntil: number;
  bgColor: string;
  wingPop?: number;
  abcGhosts?: AbcGhostItem[];
}

/**
 * Reusable hollow outline + translucent tint overlay for stacked X-Ray cutouts and chain clusters.
 */
export function renderTintedCutoutOverlay(
  ctx: CanvasRenderingContext2D,
  silBuf: OffscreenCanvas | HTMLCanvasElement,
  outBuf: OffscreenCanvas | HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
  color: string,
  fillAlpha: number,
  outlineAlpha: number,
  drawShape: (g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
): void {
  if (silBuf.width !== w || silBuf.height !== h) {
    silBuf.width = w;
    silBuf.height = h;
  }
  if (outBuf.width !== w || outBuf.height !== h) {
    outBuf.width = w;
    outBuf.height = h;
  }
  const sctx = silBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  const octx = outBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!sctx || !octx) return;

  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  drawShape(sctx);

  // Convert sprite cutout into a solid colored mask
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, w, h);
  sctx.globalCompositeOperation = 'source-over';

  // Dilate radially into outBuf, then punch out interior to leave crisp hollow outline
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, w, h);
  const r = Math.max(1.5, 2.2 * dpr);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    octx.drawImage(silBuf, Math.cos(a) * r, Math.sin(a) * r);
  }
  octx.globalCompositeOperation = 'destination-out';
  octx.drawImage(silBuf, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  // Composite tint + crisp outline on target canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = fillAlpha;
  ctx.drawImage(silBuf, 0, 0);
  ctx.globalAlpha = outlineAlpha;
  ctx.drawImage(outBuf, 0, 0);
  ctx.restore();
}

export function renderGreenXRayCutout(
  ctx: CanvasRenderingContext2D,
  silBuf: OffscreenCanvas | HTMLCanvasElement,
  outBuf: OffscreenCanvas | HTMLCanvasElement,
  w: number,
  h: number,
  dpr: number,
  drawShape: (g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
): void {
  renderTintedCutoutOverlay(ctx, silBuf, outBuf, w, h, dpr, GREEN, 0.24, 0.94, drawShape);
}

export class StageRenderer {
  private glowGreen: OffscreenCanvas | HTMLCanvasElement | null = null;
  private glowMagenta: OffscreenCanvas | HTMLCanvasElement | null = null;
  private glowWingHint: OffscreenCanvas | HTMLCanvasElement | null = null;
  private lo: OffscreenCanvas | HTMLCanvasElement | null = null;
  private loc: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private ghostBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private xraySilBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private xrayOutBuf: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tmpMat = new Float64Array(6);
  private SKP = [0, 0, 0, 0, 0, 0];

  public drawn = 0;
  public culled = 0;

  private mkGlow(rgb: string) {
    const c = mkCanvas(64, 64);
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, `rgba(${rgb},.95)`);
    r.addColorStop(0.35, `rgba(${rgb},.3)`);
    r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  private mkSoftHintGlow() {
    const c = mkCanvas(64, 64);
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    r.addColorStop(0, 'rgba(52, 211, 153, 0.34)');
    r.addColorStop(0.45, 'rgba(52, 211, 153, 0.14)');
    r.addColorStop(1, 'rgba(52, 211, 153, 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  private drawArt(
    c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    f: number,
    w: number,
    h: number,
    state: RenderContextState,
  ) {
    this.drawn = 0;
    this.culled = 0;
    const k = state.z * f;
    const X0 = state.ox * f;
    const Y0 = state.oy * f;

    const wingPop = state.wingPop ?? 0;

    for (const p of state.pieces) {
      const bm = p.bm;
      if (!bm || !p.node) continue;
      const q = getPieceWorldMatrix(p, wingPop, this.tmpMat);
      const m0 = k * q[0];
      const m1 = k * q[1];
      const m2 = k * q[2];
      const m3 = k * q[3];
      const m4 = k * q[4] + X0;
      const m5 = k * q[5] + Y0;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const X = m0 * cx + m2 * cy + m4;
      const Y = m1 * cx + m3 * cy + m5;
      const r = 0.5 * Math.hypot(p.w, p.h) * Math.hypot(m0, m1);

      if (X + r < 0 || Y + r < 0 || X - r > w || Y - r > h) {
        this.culled++;
        continue;
      }
      c.setTransform(m0, m1, m2, m3, m4, m5);
      c.drawImage(bm, p.x, p.y, p.w, p.h);
      this.drawn++;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  private computeSkull(state: RenderContextState): boolean {
    const hd = state.by.head;
    if (!hd || !hd.pieces.length) return false;
    const w = hd.w;
    for (let i = 0; i < 2; i++) {
      const x = SK[i][0];
      const y = SK[i][1];
      this.SKP[i * 2] = (w[0] * x + w[2] * y + w[4]) * state.z + state.ox;
      this.SKP[i * 2 + 1] = (w[1] * x + w[3] * y + w[5]) * state.z + state.oy;
    }
    const ct = state.by.chinTip;
    if (ct) {
      const q = pos(ct, state.by);
      this.SKP[4] = q[0] * state.z + state.ox;
      this.SKP[5] = q[1] * state.z + state.oy;
    } else {
      const x = SK[2][0];
      const y = SK[2][1];
      this.SKP[4] = (w[0] * x + w[2] * y + w[4]) * state.z + state.ox;
      this.SKP[5] = (w[1] * x + w[3] * y + w[5]) * state.z + state.oy;
    }
    return true;
  }

  private forEachSegment(
    state: RenderContextState,
    sk: boolean,
    fn: (x0: number, y0: number, x1: number, y1: number, passKind: number) => void,
  ) {
    const { nodes, by, z, ox, oy } = state;
    for (const n of nodes) {
      const par = parentOf(n, by);
      if (par) {
        const a = pos(par, by);
        const b = pos(n, by);
        fn(a[0] * z + ox, a[1] * z + oy, b[0] * z + ox, b[1] * z + oy, n.ghost ? 2 : 0);
      }
      if (n.at) {
        const a = pos(n, by);
        const w = n.w;
        const t = n.at;
        fn(
          a[0] * z + ox,
          a[1] * z + oy,
          (w[0] * t[0] + w[2] * t[1] + w[4]) * z + ox,
          (w[1] * t[0] + w[3] * t[1] + w[5]) * z + oy,
          0,
        );
      }
      if (n.bar && by[n.bar[0]] && by[n.bar[1]]) {
        const a = pos(by[n.bar[0]], by);
        const b = pos(by[n.bar[1]], by);
        fn(a[0] * z + ox, a[1] * z + oy, b[0] * z + ox, b[1] * z + oy, 0);
      }
      if (n.bond && n.bond.aim && by[n.bond.aim.to]) {
        const A = pos(by[n.bond.aim.to], by);
        const Q = pos(n.bond, by);
        const strained = Math.abs(n.eff - n.ang) > 0.05;
        fn(Q[0] * z + ox, Q[1] * z + oy, A[0] * z + ox, A[1] * z + oy, strained ? 1 : 0);
      }
    }
    if (sk) {
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        fn(this.SKP[i * 2], this.SKP[i * 2 + 1], this.SKP[j * 2], this.SKP[j * 2 + 1], 0);
      }
    }
  }

  private drawBonesLayer(state: RenderContextState, analog: boolean) {
    const { ctx, nodes, by, sel, z, ox, oy, dpr } = state;
    const sk = this.computeSkull(state);
    this.glowGreen = this.glowGreen || this.mkGlow('34,197,94');
    this.glowMagenta = this.glowMagenta || this.mkGlow('255,59,107');

    if (analog) {
      ctx.strokeStyle = 'rgba(34,197,94,.42)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind !== 2) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
    } else {
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 3; pass++) {
        for (const [wd, al] of [
          [11, 0.14],
          [6, 0.28],
          [2, 0.88],
        ]) {
          ctx.strokeStyle = pass === 1 ? MAGENTA : GREEN;
          ctx.lineWidth = wd * dpr;
          ctx.globalAlpha = al * (pass === 2 ? 0.3 : 1);
          ctx.beginPath();
          this.forEachSegment(state, sk, (a, b, c, e, kind) => {
            if (kind === pass) {
              ctx.moveTo(a, b);
              ctx.lineTo(c, e);
            }
          });
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }

    const drawDot = (x: number, y: number, isTension: boolean, ghost: boolean, scale = 1) => {
      const r = (analog ? 9 : 15) * scale * dpr;
      const g = isTension ? this.glowMagenta! : this.glowGreen!;
      const m = ghost ? 0.3 : 1;
      ctx.globalAlpha = (analog ? 0.55 : 0.92) * m;
      ctx.drawImage(g, x - r, y - r, 2 * r, 2 * r);
      if (!analog) {
        const r2 = 4 * scale * dpr;
        ctx.drawImage(g, x - r2, y - r2, 2 * r2, 2 * r2);
      }
    };

    for (const n of nodes) {
      if (n.id === 'wingL' || n.id === 'wingR') continue;
      if (n.ghost && analog) continue;
      const q = pos(n, by);
      const tension = getTensionRatio(n);
      const strainedBond = n.bond && Math.abs(n.eff - n.ang) > 0.05;
      const isSwivel = n.id.startsWith('swivel');
      drawDot(
        q[0] * z + ox,
        q[1] * z + oy,
        n === sel || tension.atLimit || !!strainedBond,
        n.ghost || isSwivel,
        isSwivel ? 0.65 : 1,
      );
    }

    for (const n of nodes) {
      if (!n.at) continue;
      const w = n.w;
      const t = n.at;
      drawDot((w[0] * t[0] + w[2] * t[1] + w[4]) * z + ox, (w[1] * t[0] + w[3] * t[1] + w[5]) * z + oy, false, false);
    }

    if (sk) {
      for (let i = 0; i < 3; i++) {
        drawDot(this.SKP[i * 2], this.SKP[i * 2 + 1], false, false);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawActiveBars(state: RenderContextState, act: number) {
    const { ctx, dpr } = state;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const sk = this.computeSkull(state);

    for (const [wd, al] of [
      [14, 0.12],
      [8, 0.25],
      [3.5, 0.6],
    ]) {
      ctx.lineWidth = wd * dpr;
      ctx.strokeStyle = GREEN;
      ctx.globalAlpha = al * act;
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind === 0) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();

      // Tension-strained bond bars glow magenta-red when active
      ctx.strokeStyle = MAGENTA;
      ctx.globalAlpha = Math.min(1, al * 1.25) * act;
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind === 1) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  private drawSelectedLimitArc(state: RenderContextState) {
    const { ctx, sel, by, z, ox, oy, dpr, constrainLimits, mode } = state;
    if (!sel || (!constrainLimits && mode !== 'D')) return;
    const [min, max] = sel.limits;
    if (min <= -179 && max >= 179) return;
    const p = pos(sel, by);
    const sx = p[0] * z + ox;
    const sy = p[1] * z + oy;
    const par = parentOf(sel, by);
    const pw = par ? par.w : [1, 0, 0, 1, 0, 0];
    const parDet = pw[0] * pw[3] - pw[1] * pw[2];
    const flipSign = parDet < 0 ? -1 : 1;
    const baseRad = Math.atan2(pw[1], pw[0]) - Math.PI / 2;
    const tension = getTensionRatio(sel);
    const r = 22 * dpr;

    ctx.save();
    ctx.lineWidth = 1.75 * dpr;
    ctx.strokeStyle = tension.atLimit || tension.nearLimit ? MAGENTA : 'rgba(168, 85, 247, 0.55)';
    ctx.beginPath();
    const aStart = baseRad + (min * flipSign * Math.PI) / 180;
    const aEnd = baseRad + (max * flipSign * Math.PI) / 180;
    ctx.arc(sx, sy, r, Math.min(aStart, aEnd), Math.max(aStart, aEnd));
    ctx.stroke();

    // Current angle needle
    const curRad = baseRad + (sel.ang * flipSign * Math.PI) / 180;
    ctx.strokeStyle = tension.atLimit ? MAGENTA : GREEN;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(curRad) * (r + 5 * dpr), sy + Math.sin(curRad) * (r + 5 * dpr));
    ctx.stroke();
    ctx.restore();
  }

  private drawStageGuides(state: RenderContextState) {
    if (!state.showGuides) return;
    const { ctx, ox, oy, W, H, z, dpr } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = PURPLE_GUIDE;
    ctx.fillStyle = PURPLE_GUIDE_TEXT;
    ctx.lineWidth = dpr;
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.strokeRect(ox, oy, W * z, H * z);

    if (W === 2500) {
      ctx.beginPath();
      ctx.moveTo(1257 * z + ox, oy);
      ctx.lineTo(1257 * z + ox, H * z + oy);
      for (let k = 1; k <= 7; k++) {
        ctx.moveTo(ox, k * 1240 * z + oy);
        ctx.lineTo(W * z + ox, k * 1240 * z + oy);
      }
      ctx.stroke();
      ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;
      for (let k = 1; k <= 7; k++) {
        ctx.fillText(`${k}H`, ox + 6 * dpr, k * 1240 * z + oy - 4 * dpr);
      }
      ctx.fillText('MX 1257', 1257 * z + ox + 6 * dpr, oy + 14 * dpr);
    }
    ctx.setLineDash([]);
  }

  private drawAbcGhosts(state: RenderContextState) {
    const ghosts = state.abcGhosts;
    if (!ghosts || !ghosts.length) return;
    const { ctx, cv, nodes, by, pieces, z, ox, oy, dpr } = state;
    const root = nodes.find((n) => !n.parent) || nodes[0];
    if (!root) return;

    if (!this.ghostBuf) {
      this.ghostBuf = mkCanvas(cv.width, cv.height);
    } else if (this.ghostBuf.width !== cv.width || this.ghostBuf.height !== cv.height) {
      this.ghostBuf.width = cv.width;
      this.ghostBuf.height = cv.height;
    }
    const gctx = this.ghostBuf.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!gctx) return;

    // Save exact live angles, flipX, + root offsets before evaluating ghost poses
    const savedAng = nodes.map((n) => n.ang);
    const savedFlip = nodes.map((n) => !!n.flipX);
    const savedTx = root.tx;
    const savedTy = root.ty;

    const wingPop = state.wingPop ?? 0;

    for (const item of ghosts) {
      for (const n of nodes) {
        if (n.id in item.pose.nodes) {
          n.ang = item.pose.nodes[n.id];
        }
        n.flipX = !!(item.pose.flipX && item.pose.flipX[n.id]);
      }
      root.tx = item.pose.root?.[0] ?? 0;
      root.ty = item.pose.root?.[1] ?? 0;
      solveRig(nodes, by, state.bondOn ?? true, wingPop);

      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of pieces) {
        const bm = p.bm;
        if (!bm || !p.node) continue;
        const q = getPieceWorldMatrix(p, wingPop, this.tmpMat);
        gctx.setTransform(z * q[0], z * q[1], z * q[2], z * q[3], z * q[4] + ox, z * q[5] + oy);
        gctx.drawImage(bm, p.x, p.y, p.w, p.h);
      }

      const tint = ABC_TINT[item.slot];
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.globalCompositeOperation = 'source-atop';
      gctx.fillStyle = tint.fill;
      gctx.fillRect(0, 0, cv.width, cv.height);
      gctx.globalCompositeOperation = 'source-over';

      const alpha = item.isPrimary ? item.opacity : item.opacity * 0.52;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.ghostBuf, 0, 0);

      // Dashed skeleton ghost lines
      ctx.globalAlpha = Math.min(0.7, alpha * 1.45);
      ctx.strokeStyle = tint.stroke;
      ctx.lineWidth = (item.isPrimary ? 1.45 : 1.0) * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      const sk = this.computeSkull(state);
      ctx.beginPath();
      this.forEachSegment(state, sk, (a, b, c, e, kind) => {
        if (kind !== 2) {
          ctx.moveTo(a, b);
          ctx.lineTo(c, e);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Slot tag near ghost head
      const hd = by.head;
      if (hd) {
        const hp = pos(hd, by);
        ctx.font = `700 ${11 * dpr}px "JetBrains Mono", monospace`;
        ctx.fillStyle = tint.badge;
        ctx.globalAlpha = Math.min(0.9, alpha * 1.8);
        ctx.fillText(item.slot, hp[0] * z + ox + 10 * dpr, hp[1] * z + oy - 14 * dpr);
      }
      ctx.restore();
    }

    // Restore live pose before painting active puppet
    nodes.forEach((n, i) => {
      n.ang = savedAng[i];
      n.flipX = savedFlip[i];
    });
    root.tx = savedTx;
    root.ty = savedTy;
    solveRig(nodes, by, state.bondOn ?? true, wingPop);
  }

  private getPieceWorldAabb(p: RigPiece, wingPop: number): [number, number, number, number] | null {
    if (!p.node) return null;
    const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
    const x0 = p.x;
    const y0 = p.y;
    const x1 = p.x + p.w;
    const y1 = p.y + p.h;
    const corners: Array<[number, number]> = [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ];
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const [cx, cy] of corners) {
      const wx = w[0] * cx + w[2] * cy + w[4];
      const wy = w[1] * cx + w[3] * cy + w[5];
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    return [minX, minY, maxX, maxY];
  }

  private isPieceOccludedInStack(targetPiece: RigPiece, targetIdx: number, pieces: RigPiece[], wingPop: number): boolean {
    const aabb = this.getPieceWorldAabb(targetPiece, wingPop);
    if (!aabb) return false;
    for (let j = targetIdx + 1; j < pieces.length; j++) {
      const front = pieces[j];
      if (!front.bm || front.node === targetPiece.node) continue;
      const fa = this.getPieceWorldAabb(front, wingPop);
      if (!fa) continue;
      const ix0 = Math.max(aabb[0], fa[0]);
      const iy0 = Math.max(aabb[1], fa[1]);
      const ix1 = Math.min(aabb[2], fa[2]);
      const iy1 = Math.min(aabb[3], fa[3]);
      if (ix0 >= ix1 || iy0 >= iy1) continue;

      if (targetPiece.m && front.m) {
        const steps = 12;
        for (let sx = 0; sx <= steps; sx++) {
          const wx = ix0 + ((ix1 - ix0) * (sx + 0.5)) / (steps + 1);
          for (let sy = 0; sy <= steps; sy++) {
            const wy = iy0 + ((iy1 - iy0) * (sy + 0.5)) / (steps + 1);
            if (samplePieceWorldMask(targetPiece, wx, wy, wingPop) && samplePieceWorldMask(front, wx, wy, wingPop)) {
              return true;
            }
          }
        }
      } else {
        return true;
      }
    }
    return false;
  }

  private isNodePointOccluded(targetNode: RigNode, wx: number, wy: number, pieces: RigPiece[], wingPop: number): boolean {
    const owner = targetNode.pieces.length ? targetNode : targetNode.parent ? null : targetNode;
    let lowestOwnerIdx = -1;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.node === targetNode || (owner === null && p.node?.id === targetNode.parent)) {
        lowestOwnerIdx = i;
        break;
      }
    }
    if (lowestOwnerIdx < 0) return false;
    for (let j = lowestOwnerIdx + 1; j < pieces.length; j++) {
      const front = pieces[j];
      if (!front.bm || front.node === targetNode || front.node?.id === targetNode.parent) continue;
      if (samplePieceWorldMask(front, wx, wy, wingPop)) return true;
    }
    return false;
  }

  private getClusterSpec(
    hov: RigNode | null,
  ): {
    kind: 'shoulder' | 'hip';
    side: 'L' | 'R';
    nodeIds: string[];
    edges: Array<[string, string]>;
  } | null {
    if (!hov) return null;
    const id = hov.id;
    const side: 'L' | 'R' | null = id.endsWith('L') ? 'L' : id.endsWith('R') ? 'R' : null;
    if (!side) return null;

    if (
      id === 'acromion' + side ||
      id === 'brace' + side ||
      id === 'wing' + side ||
      id === 'swivel' + side ||
      id === 'swivelTip' + side
    ) {
      return {
        kind: 'shoulder',
        side,
        nodeIds: ['swivel' + side, 'acromion' + side, 'brace' + side],
        edges: [
          ['lumbar', 'swivel' + side],
          ['swivel' + side, 'acromion' + side],
          ['thorax', 'brace' + side],
          ['brace' + side, 'acromion' + side],
        ],
      };
    }

    if (id === 'hip' + side) {
      return {
        kind: 'hip',
        side,
        nodeIds: ['hip' + side, 'femur' + side, 'shin' + side, 'foot' + side],
        edges: [
          ['pelvis', 'hip' + side],
          ['hip' + side, 'femur' + side],
          ['femur' + side, 'shin' + side],
          ['shin' + side, 'foot' + side],
        ],
      };
    }

    return null;
  }

  private drawClusterHighlight(state: RenderContextState): boolean {
    const { hov, pieces, ctx, cv, z, ox, oy, dpr, by } = state;
    const spec = this.getClusterSpec(hov);
    if (!spec || !hov) return false;

    const wingPop = state.wingPop ?? 0;
    const isWingHover = hov.id === 'wingL' || hov.id === 'wingR';
    const clusterNodeSet = new Set(spec.nodeIds);

    // 1. If hovering faint green wing hint, expose hidden Backshoulder silhouette clearly first
    if (isWingHover && hov.parent && by[hov.parent]) {
      const brace = by[hov.parent];
      const wingPieces = pieces.filter((p) => p.node === brace && p.wing && p.bm);
      if (wingPieces.length) {
        if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
        if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);
        renderTintedCutoutOverlay(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, GREEN, 0.34, 0.96, (g) => {
          for (const p of wingPieces) {
            const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
            g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
            g.drawImage(p.bm!, p.x, p.y, p.w, p.h);
          }
        });
      }
    }

    // 2. Highlight entire chain cluster pieces in RED so user knows dragging sets off a chain
    const clusterPieces = pieces.filter((p) => {
      if (!p.bm || !p.node || !clusterNodeSet.has(p.node.id)) return false;
      if (p.wing && wingPop <= 0.05 && isWingHover) return false;
      return true;
    });

    if (clusterPieces.length) {
      if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
      if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);
      renderTintedCutoutOverlay(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, RED, 0.16, 0.88, (g) => {
        for (const p of clusterPieces) {
          const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
          g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
          g.drawImage(p.bm!, p.x, p.y, p.w, p.h);
        }
      });
    }

    // 3. Red dashed chain links & joint markers connecting every bone in the cluster
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.86)';
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (const [idA, idB] of spec.edges) {
      const a = by[idA];
      const b = by[idB];
      if (!a || !b) continue;
      const pa = pos(a, by);
      const pb = pos(b, by);
      ctx.moveTo(pa[0] * z + ox, pa[1] * z + oy);
      ctx.lineTo(pb[0] * z + ox, pb[1] * z + oy);
    }
    // For hip cluster, also draw chain indicator up to the iliac upper round handle + swivel arc
    let hipHandleScreen: [number, number] | null = null;
    if (spec.kind === 'hip') {
      const hipNode = by['hip' + spec.side];
      if (hipNode && hipNode.at) {
        const w = hipNode.w;
        const hp = pos(hipNode, by);
        const tx = (w[0] * hipNode.at[0] + w[2] * hipNode.at[1] + w[4]) * z + ox;
        const ty = (w[1] * hipNode.at[0] + w[3] * hipNode.at[1] + w[5]) * z + oy;
        hipHandleScreen = [tx, ty];
        ctx.moveTo(hp[0] * z + ox, hp[1] * z + oy);
        ctx.lineTo(tx, ty);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (hipHandleScreen) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 1.75 * dpr;
      ctx.beginPath();
      ctx.arc(hipHandleScreen[0], hipHandleScreen[1], 11 * dpr, -Math.PI * 0.85, -Math.PI * 0.15);
      ctx.stroke();
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(hipHandleScreen[0], hipHandleScreen[1], 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = RED;
    for (const id of spec.nodeIds) {
      const n = by[id];
      if (!n) continue;
      const q = pos(n, by);
      ctx.beginPath();
      ctx.arc(q[0] * z + ox, q[1] * z + oy, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return true;
  }

  private drawXRayStackOverlay(state: RenderContextState): boolean {
    const { hov, pieces, ctx, cv, z, ox, oy, dpr, by } = state;
    if (!hov) return false;
    if (this.drawClusterHighlight(state)) {
      return true;
    }

    const wingPop = state.wingPop ?? 0;

    const occludedPieces: RigPiece[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.node === hov && p.bm && this.isPieceOccludedInStack(p, i, pieces, wingPop)) {
        occludedPieces.push(p);
      }
    }

    const q = pos(hov, by);
    const pointOccluded = !occludedPieces.length && this.isNodePointOccluded(hov, q[0], q[1], pieces, wingPop);
    if (!occludedPieces.length && !pointOccluded) return false;

    if (occludedPieces.length) {
      if (!this.xraySilBuf) this.xraySilBuf = mkCanvas(cv.width, cv.height);
      if (!this.xrayOutBuf) this.xrayOutBuf = mkCanvas(cv.width, cv.height);

      renderGreenXRayCutout(ctx, this.xraySilBuf, this.xrayOutBuf, cv.width, cv.height, dpr, (g) => {
        for (const p of occludedPieces) {
          const bm = p.bm;
          if (!bm || !p.node) continue;
          const w = getPieceWorldMatrix(p, wingPop, this.tmpMat);
          g.setTransform(z * w[0], z * w[1], z * w[2], z * w[3], z * w[4] + ox, z * w[5] + oy);
          g.drawImage(bm, p.x, p.y, p.w, p.h);
        }
      });

      // Subtle green X-ray bone axis through occluding front layers
      const par = parentOf(hov, by);
      if (par) {
        const a = pos(par, by);
        const b = pos(hov, by);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.68)';
        ctx.lineWidth = 1.6 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(a[0] * z + ox, a[1] * z + oy);
        ctx.lineTo(b[0] * z + ox, b[1] * z + oy);
        ctx.stroke();
        ctx.restore();
      }
    }

    return true;
  }

  private drawWingCircles(state: RenderContextState) {
    const { ctx, by, z, ox, oy, dpr, sel, hov } = state;
    const wingPop = state.wingPop ?? 0;
    const active = wingPop > 0.05;
    this.glowWingHint = this.glowWingHint || this.mkSoftHintGlow();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const id of ['wingL', 'wingR'] as const) {
      const wn = by[id];
      if (!wn) continue;
      const p = pos(wn, by);
      const sx = p[0] * z + ox;
      const sy = p[1] * z + oy;
      const isDirectHover = hov === wn || sel === wn;

      if (!active && !isDirectHover) {
        // Subtle, blurred faint emerald hint at rest (no crisp ring or solid dot)
        const rHint = 17 * dpr;
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.glowWingHint!, sx - rHint, sy - rHint, 2 * rHint, 2 * rHint);
        continue;
      }

      const r = (active ? 9.5 : 8.5) * dpr;
      ctx.globalAlpha = 1;
      ctx.fillStyle = active ? 'rgba(168, 85, 247, 0.24)' : 'rgba(239, 68, 68, 0.16)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 1.9 * dpr;
      ctx.strokeStyle = active ? '#c084fc' : RED;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = active ? '#e9d5ff' : 'rgba(52, 211, 153, 0.9)';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private isNodeOutOfView(hov: RigNode, state: RenderContextState): boolean {
    const { cv, by, z, ox, oy } = state;
    const wingPop = state.wingPop ?? 0;
    const q = pos(hov, by);
    const sx = q[0] * z + ox;
    const sy = q[1] * z + oy;
    if (sx < 0 || sy < 0 || sx > cv.width || sy > cv.height) {
      return true;
    }
    for (const p of hov.pieces) {
      if (!p.bm) continue;
      const box = this.getPieceWorldAabb(p, wingPop);
      if (!box) continue;
      const bx0 = box[0] * z + ox;
      const by0 = box[1] * z + oy;
      const bx1 = box[2] * z + ox;
      const by1 = box[3] * z + oy;
      if (bx1 <= 0 || by1 <= 0 || bx0 >= cv.width || by0 >= cv.height) {
        return true;
      }
      const totalArea = Math.max(1, (bx1 - bx0) * (by1 - by0));
      const ix0 = Math.max(0, bx0);
      const iy0 = Math.max(0, by0);
      const ix1 = Math.min(cv.width, bx1);
      const iy1 = Math.min(cv.height, by1);
      const visibleArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      if (visibleArea / totalArea < 0.45) {
        return true;
      }
    }
    return false;
  }

  public render(state: RenderContextState) {
    const { ctx, cv, mode, showBones, isActiveMotion, actUntil, hov, sel, by, z, ox, oy, dpr } = state;
    const w = cv.width;
    const h = cv.height;
    const now = performance.now();
    const live = mode === 'A' && showBones && (isActiveMotion || now < actUntil);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, w, h);

    this.drawAbcGhosts(state);

    if (mode === 'A') {
      if (showBones) this.drawBonesLayer(state, true);
      this.drawArt(ctx, 1, w, h, state);
      if (showBones && live) {
        this.drawActiveBars(state, isActiveMotion ? 1 : Math.max(0, Math.min(1, (actUntil - now) / 700)));
      }
    } else {
      const f = 0.2;
      const lw = Math.max(1, Math.ceil(w * f));
      const lh = Math.max(1, Math.ceil(h * f));
      if (!this.lo || this.lo.width !== lw || this.lo.height !== lh) {
        this.lo = mkCanvas(lw, lh);
        this.loc = this.lo.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      }
      if (this.loc) {
        this.loc.setTransform(1, 0, 0, 1, 0, 0);
        this.loc.clearRect(0, 0, lw, lh);
        this.drawArt(this.loc, f, lw, lh, state);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 0.6;
        ctx.drawImage(this.lo, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (showBones) this.drawBonesLayer(state, false);
    }

    const isObscured = this.drawXRayStackOverlay(state);
    this.drawWingCircles(state);

    if (hov) {
      const q = pos(hov, by);
      const sx = q[0] * z + ox;
      const sy = q[1] * z + oy;
      const outOfView = this.isNodeOutOfView(hov, state);
      const isRedXRay = isObscured || outOfView;
      const pad = 18 * dpr;
      const clampedX = Math.max(pad, Math.min(w - pad, sx));
      const clampedY = Math.max(pad, Math.min(h - pad, sy));
      const pivotOffscreen = sx < 0 || sy < 0 || sx > w || sy > h;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (isRedXRay) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
        ctx.beginPath();
        ctx.arc(clampedX, clampedY, 12 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = (isRedXRay ? 2.25 : 2) * dpr;
      ctx.strokeStyle = isRedXRay ? RED : hov === sel ? MAGENTA : GREEN;
      ctx.beginPath();
      ctx.arc(clampedX, clampedY, 12 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      if (pivotOffscreen) {
        const ang = Math.atan2(sy - clampedY, sx - clampedX);
        const tx = clampedX + Math.cos(ang) * (15 * dpr);
        const ty = clampedY + Math.sin(ang) * (15 * dpr);
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.arc(tx, ty, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    this.drawSelectedLimitArc(state);
    this.drawStageGuides(state);
  }
}
