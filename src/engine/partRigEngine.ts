import { DEG, decImage, mkCanvas, setPieceBitmap } from './fkEngine';
import type { Keyframe, PartRigInstance, PartsManifest, RigNode } from './types';

export const SKL = 'Skullbone/skull/skullplate';

export const FACE = {
  tree: {
    Forehead: SKL,
    Crownpin: SKL,
    Furlbone: SKL,
    Eyeframe1: SKL,
    Eyeframe2: SKL,
    Cheek1: SKL,
    Cheek2: SKL,
    Nasalcavity: SKL,
    Throatbone: SKL,
    'Upper Lip': SKL,
    Chin: SKL,
    Socketbone1: 'Eyeframe1',
    Eyeball1: 'Eyeframe1',
    Iris1: 'Eyeball1',
    Pupil1: 'Iris1',
    Socketbone2: 'Eyeframe2',
    Eyeball2: 'Eyeframe2',
    Iris2: 'Eyeball2',
    Pupil2: 'Iris2',
    Nosepin: 'Nasalcavity',
    'Upper Jowl1': 'Cheek1',
    'Upper Jowl2': 'Cheek2',
    'Upper Teeth': 'Upper Lip',
    Chinpin: 'Chin',
    Chinrest: 'Chin',
    'Bottom Teeth': 'Chin',
    Jowl1: 'Chin',
    Jowl2: 'Chin',
  } as Record<string, string>,
  pivot: {
    Chin: 'Upper Lip',
    Cheek1: 'Upper Lip',
    Cheek2: 'Upper Lip',
    'Upper Jowl1': 'Upper Lip',
    'Upper Jowl2': 'Upper Lip',
  } as Record<string, string>,
  at: {
    Jowl1: [1125, 2614],
    Jowl2: [1875, 2614],
  } as Record<string, [number, number]>,
  hinge: ['Chin', 'Cheek1', 'Cheek2', 'Upper Jowl1', 'Upper Jowl2'],
  exc: {} as Record<string, [number, number]>,
};

export const PART_LINKS = [{ node: 'lip', inst: 'head', name: 'Chin', k: -1 }];

const FOOTA = [
  -0.19088577804596826,
  -0.1996935484063157,
  -0.3096125456814106,
  0.2959566402963461,
  1152.5055661304632,
  133.5272042764406,
];

export class PartRigManager {
  public inst: Record<string, PartRigInstance> = {};
  private parts: PartsManifest;
  private partLoadPromises: Partial<Record<'head' | 'hand' | 'foot', Promise<void>>> = {};
  private links = PART_LINKS.map((l) => ({ ...l }));

  constructor(parts: PartsManifest) {
    this.parts = parts;
  }

  public loadPartAssets(key: 'head' | 'hand' | 'foot'): Promise<void> {
    if (!this.partLoadPromises[key]) {
      const pieces = this.parts[key].views[0].pieces;
      this.partLoadPromises[key] = Promise.all(pieces.map((p) => decImage(p.src))).then((bms) => {
        pieces.forEach((p, i) => {
          p.bm = bms[i];
        });
      });
    }
    return this.partLoadPromises[key]!;
  }

  private mkInst(
    id: string,
    key: 'head' | 'hand' | 'foot',
    nid: string,
    mir: boolean,
    by: Record<string, RigNode>,
    onWake: () => void,
  ): void {
    const n = by[nid];
    if (!n || !n.pieces.length) return;
    const ps = this.parts[key].views[0].pieces;
    const fp = n.pieces[0];
    const on = ps.map((p) => (p.on ? 1 : 0));

    let m: number[];
    if (key === 'foot') {
      m = FOOTA.slice();
    } else {
      const q = ps.filter((p) => p.on);
      const x0 = Math.min(...q.map((p) => p.x));
      const y0 = Math.min(...q.map((p) => p.y));
      const x1 = Math.max(...q.map((p) => p.x + p.w));
      const y1 = Math.max(...q.map((p) => p.y + p.h));
      const a = fp.w / (x1 - x0);
      const d = fp.h / (y1 - y0);
      m = [a, 0, 0, d, -x0 * a, -y0 * d];
    }
    if (mir) {
      m = [-m[0], m[1], -m[2], m[3], fp.w - m[4], m[5]];
    }

    const idx: Record<string, number> = {};
    ps.forEach((p, k) => {
      idx[p.name] = k;
    });
    const par = new Int16Array(ps.length).fill(-1);
    const pv = new Float32Array(ps.length * 2);
    ps.forEach((p, k) => {
      pv[2 * k] = p.x + p.w / 2;
      pv[2 * k + 1] = p.y + p.h / 2;
    });

    if (key === 'head') {
      for (const c in FACE.tree) {
        const a = idx[c];
        const b = idx[FACE.tree[c]];
        if (a != null && b != null) par[a] = b;
      }
      for (const c in FACE.pivot) {
        const a = idx[c];
        const b = idx[FACE.pivot[c]];
        if (a != null && b != null) {
          pv[2 * a] = pv[2 * b];
          pv[2 * a + 1] = pv[2 * b + 1];
        }
      }
      for (const c in FACE.at) {
        const a = idx[c];
        if (a != null) {
          pv[2 * a] = FACE.at[c][0];
          pv[2 * a + 1] = FACE.at[c][1];
        }
      }
      for (const c in FACE.exc) {
        const a = idx[c];
        if (a != null) {
          pv[2 * a] += FACE.exc[c][0];
          pv[2 * a + 1] += FACE.exc[c][1];
        }
      }
    }

    const ord: number[] = [];
    const seen = new Uint8Array(ps.length);
    const vis = (k: number) => {
      if (seen[k]) return;
      seen[k] = 1;
      if (par[k] >= 0) vis(par[k]);
      ord.push(k);
    };
    ps.forEach((_p, k) => vis(k));

    const tree: Array<{ k: number; d: number }> = [];
    const walk = (k: number, d: number) => {
      tree.push({ k, d });
      ps.forEach((_p, j) => {
        if (par[j] === k) walk(j, d + 1);
      });
    };
    ps.forEach((_p, k) => {
      if (par[k] < 0) walk(k, 0);
    });

    this.inst[id] = {
      id,
      key,
      fp,
      ps,
      m,
      par,
      pv,
      ord,
      tree,
      W: new Float64Array(6 * ps.length),
      flip: 0,
      title: this.parts[key].title,
      on0: on,
      on: Uint8Array.from(on),
      ang: new Float32Array(ps.length),
      dx: new Float32Array(ps.length),
      dy: new Float32Array(ps.length),
      touched: 0,
      h: '',
      q: 0,
      reset() {
        this.on.set(this.on0);
        this.ang.fill(0);
        this.dx.fill(0);
        this.dy.fill(0);
        this.flip = 0;
        this.touched = 0;
        this.h = '';
        const sourceBm = (fp.full0 || fp.bm0) as (CanvasImageSource & { width: number; height: number }) | undefined;
        if (sourceBm) {
          setPieceBitmap(fp, sourceBm, onWake);
        }
      },
    };
  }

  public initAll(by: Record<string, RigNode>, onWake: () => void): void {
    for (const k in this.inst) delete this.inst[k];
    this.mkInst('head', 'head', 'head', false, by, onWake);
    this.mkInst('handR', 'hand', 'handR', false, by, onWake);
    this.mkInst('handL', 'hand', 'handL', true, by, onWake);
    this.mkInst('footR', 'foot', 'footR', false, by, onWake);
    this.mkInst('footL', 'foot', 'footL', true, by, onWake);
    for (const l of this.links) {
      const I = this.inst[l.inst];
      l.k = I ? I.ps.findIndex((p) => p.name === l.name) : -1;
    }
  }

  public syncLinks(by: Record<string, RigNode>, onWake: () => void): void {
    for (const l of this.links) {
      const I = this.inst[l.inst];
      const n = by[l.node];
      if (I && n && l.k >= 0 && Math.abs(I.ang[l.k] - n.ang) > 1e-3) {
        I.ang[l.k] = n.ang;
        I.touched = 1;
        this.rebake(I, onWake);
      }
    }
  }

  public linkOut(I: PartRigInstance, by: Record<string, RigNode>): void {
    for (const l of this.links) {
      if (l.inst === I.id && l.k >= 0 && by[l.node]) {
        by[l.node].ang = I.ang[l.k];
      }
    }
  }

  public static pfk(I: PartRigInstance): void {
    const W = I.W;
    for (const k of I.ord) {
      const a = I.ang[k] * DEG;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const px = I.pv[2 * k];
      const py = I.pv[2 * k + 1];
      const e = px - c * px + s * py + I.dx[k];
      const f = py - s * px - c * py + I.dy[k];
      const q = I.par[k];
      const o = 6 * k;
      if (q < 0) {
        W[o] = c;
        W[o + 1] = s;
        W[o + 2] = -s;
        W[o + 3] = c;
        W[o + 4] = e;
        W[o + 5] = f;
      } else {
        const t = 6 * q;
        W[o] = W[t] * c + W[t + 2] * s;
        W[o + 1] = W[t + 1] * c + W[t + 3] * s;
        W[o + 2] = -W[t] * s + W[t + 2] * c;
        W[o + 3] = -W[t + 1] * s + W[t + 3] * c;
        W[o + 4] = W[t] * e + W[t + 2] * f + W[t + 4];
        W[o + 5] = W[t + 1] * e + W[t + 3] * f + W[t + 5];
      }
    }
  }

  private bake(I: PartRigInstance, onWake: () => void): void {
    PartRigManager.pfk(I);
    const fp = I.fp;
    const s = Math.min(1, 512 / Math.max(fp.w, fp.h));
    const c = mkCanvas(Math.ceil(fp.w * s), Math.ceil(fp.h * s));
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const m = I.flip ? [-I.m[0], I.m[1], -I.m[2], I.m[3], fp.w - I.m[4], I.m[5]] : I.m;
    const W = I.W;
    for (let k = I.ps.length - 1; k >= 0; k--) {
      if (!I.on[k]) continue;
      const p = I.ps[k];
      if (!p.bm) continue;
      const o = 6 * k;
      g.setTransform(
        s * (m[0] * W[o] + m[2] * W[o + 1]),
        s * (m[1] * W[o] + m[3] * W[o + 1]),
        s * (m[0] * W[o + 2] + m[2] * W[o + 3]),
        s * (m[1] * W[o + 2] + m[3] * W[o + 3]),
        s * (m[0] * W[o + 4] + m[2] * W[o + 5] + m[4]),
        s * (m[1] * W[o + 4] + m[3] * W[o + 5] + m[5]),
      );
      g.drawImage(p.bm, p.x, p.y, p.w, p.h);
    }
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(c).then((b) => setPieceBitmap(fp, b, onWake));
    } else {
      setPieceBitmap(fp, c as HTMLCanvasElement, onWake);
    }
  }

  public rebake = (I: PartRigInstance, onWake?: () => void): void => {
    const h = `${I.flip}${I.on.join('')}${I.ang.join()}${I.dx.join()}${I.dy.join()}`;
    if (I.q || h === I.h) return;
    I.h = h;
    I.q = 1;
    requestAnimationFrame(() => {
      I.q = 0;
      this.loadPartAssets(I.key).then(() => this.bake(I, onWake || (() => {})));
    });
  };

  public partSnap(): Record<string, number[]> {
    const o: Record<string, number[]> = {};
    for (const id in this.inst) {
      const I = this.inst[id];
      if (I.touched) o[id] = Array.from(I.ang);
    }
    return o;
  }

  public partApply(A: Keyframe, B: Keyframe, t: number, onWake: () => void): void {
    const sh = (d: number) => ((d + 540) % 360) - 180;
    for (const id in A.s || {}) {
      const I = this.inst[id];
      const a = A.s?.[id];
      if (!I || !a) continue;
      const b = B.s?.[id] || a;
      for (let k = 0; k < a.length; k++) {
        I.ang[k] = a[k] + sh(b[k] - a[k]) * t;
      }
      I.touched = 1;
      this.rebake(I, onWake);
    }
  }
}
