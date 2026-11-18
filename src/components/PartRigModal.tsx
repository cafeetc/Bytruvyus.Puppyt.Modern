import React, { useCallback, useEffect, useRef, useState } from 'react';
import { renderGreenXRayCutout } from '../engine/canvasRenderer';
import { DEG, mkCanvas } from '../engine/fkEngine';
import { FACE, PartRigManager } from '../engine/partRigEngine';
import type { PartRigInstance } from '../engine/types';

interface PartRigModalProps {
  part: PartRigInstance | null;
  onClose: () => void;
  onMutated: (part: PartRigInstance) => void;
}

const GREEN = '#22c55e';
const MAGENTA = '#ff3b6b';

function getPartWorldAabb(part: PartRigInstance, k: number): [number, number, number, number] {
  const p = part.ps[k];
  const W = part.W;
  const o = 6 * k;
  const corners: Array<[number, number]> = [
    [p.x, p.y],
    [p.x + p.w, p.y],
    [p.x, p.y + p.h],
    [p.x + p.w, p.y + p.h],
  ];
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  for (const [cx, cy] of corners) {
    const wx = W[o] * cx + W[o + 2] * cy + W[o + 4];
    const wy = W[o + 1] * cx + W[o + 3] * cy + W[o + 5];
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  return [minX, minY, maxX, maxY];
}

export const PartRigModal: React.FC<PartRigModalProps> = ({ part, onClose, onMutated }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const xraySilRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const xrayOutRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const occTestRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [angleVal, setAngleVal] = useState(0);
  const [flipVal, setFlipVal] = useState(0);
  const [, setTick] = useState(0);

  const viewRef = useRef({ z: 1, ox: 0, oy: 0, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const dragRef = useRef<{ a0: number; s: number } | null>(null);

  const cen = useCallback((pe: PartRigInstance, k: number): [number, number] => {
    const W = pe.W;
    const o = 6 * k;
    const x = pe.pv[2 * k];
    const y = pe.pv[2 * k + 1];
    return [W[o] * x + W[o + 2] * y + W[o + 4], W[o + 1] * x + W[o + 3] * y + W[o + 5]];
  }, []);

  const isLayerOccludedInStack = useCallback((pe: PartRigInstance, targetIdx: number): boolean => {
    if (!pe.on[targetIdx] || !pe.ps[targetIdx]?.bm) return false;
    const targetBox = getPartWorldAabb(pe, targetIdx);
    const frontIndices: number[] = [];
    let ix0 = 1e9;
    let iy0 = 1e9;
    let ix1 = -1e9;
    let iy1 = -1e9;

    for (let j = 0; j < targetIdx; j++) {
      if (!pe.on[j] || !pe.ps[j]?.bm) continue;
      const fb = getPartWorldAabb(pe, j);
      const ox0 = Math.max(targetBox[0], fb[0]);
      const oy0 = Math.max(targetBox[1], fb[1]);
      const ox1 = Math.min(targetBox[2], fb[2]);
      const oy1 = Math.min(targetBox[3], fb[3]);
      if (ox0 < ox1 && oy0 < oy1) {
        frontIndices.push(j);
        ix0 = Math.min(ix0, ox0);
        iy0 = Math.min(iy0, oy0);
        ix1 = Math.max(ix1, ox1);
        iy1 = Math.max(iy1, oy1);
      }
    }
    if (!frontIndices.length || ix1 <= ix0 || iy1 <= iy0) return false;

    const S = 72;
    if (!occTestRef.current) occTestRef.current = mkCanvas(S, S);
    const oc = occTestRef.current;
    const g = oc.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!g) return true;

    const sx = S / (ix1 - ix0);
    const sy = S / (iy1 - iy0);
    const W = pe.W;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    const tp = pe.ps[targetIdx];
    const to = 6 * targetIdx;
    g.setTransform(
      sx * W[to],
      sy * W[to + 1],
      sx * W[to + 2],
      sy * W[to + 3],
      sx * (W[to + 4] - ix0),
      sy * (W[to + 5] - iy0),
    );
    g.drawImage(tp.bm!, tp.x, tp.y, tp.w, tp.h);

    // Mask against front layers using destination-in on a scratch? Simpler: check source-in with each front layer
    g.globalCompositeOperation = 'source-in';
    for (const j of frontIndices) {
      const fp = pe.ps[j];
      const fo = 6 * j;
      g.setTransform(
        sx * W[fo],
        sy * W[fo + 1],
        sx * W[fo + 2],
        sy * W[fo + 3],
        sx * (W[fo + 4] - ix0),
        sy * (W[fo + 5] - iy0),
      );
      g.drawImage(fp.bm!, fp.x, fp.y, fp.w, fp.h);
      const data = g.getImageData(0, 0, S, S).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 25) {
          g.globalCompositeOperation = 'source-over';
          return true;
        }
      }
      // Restore target alpha mask for next front layer test
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, S, S);
      g.setTransform(
        sx * W[to],
        sy * W[to + 1],
        sx * W[to + 2],
        sy * W[to + 3],
        sx * (W[to + 4] - ix0),
        sy * (W[to + 5] - iy0),
      );
      g.drawImage(tp.bm!, tp.x, tp.y, tp.w, tp.h);
      g.globalCompositeOperation = 'source-in';
    }
    g.globalCompositeOperation = 'source-over';
    return false;
  }, []);

  const drawPart = useCallback(
    (activeIdx = selectedIdx, hovIdx = hoveredIdx) => {
      const pc = canvasRef.current;
      if (!pc || !part) return;
      const pg = pc.getContext('2d');
      if (!pg) return;

      PartRigManager.pfk(part);
      const { z: pz, ox: pox, oy: poy, dpr } = viewRef.current;
      const W = part.W;

      pg.setTransform(1, 0, 0, 1, 0, 0);
      pg.fillStyle = '#121315';
      pg.fillRect(0, 0, pc.width, pc.height);

      for (let k = part.ps.length - 1; k >= 0; k--) {
        if (!part.on[k]) continue;
        const p = part.ps[k];
        if (!p.bm) continue;
        const o = 6 * k;
        pg.setTransform(
          pz * W[o],
          pz * W[o + 1],
          pz * W[o + 2],
          pz * W[o + 3],
          pz * W[o + 4] + pox,
          pz * W[o + 5] + poy,
        );
        pg.drawImage(p.bm, p.x, p.y, p.w, p.h);
      }

      // X-Ray view when hovering an item in a stack that has layers in front of it
      if (hovIdx !== null && isLayerOccludedInStack(part, hovIdx)) {
        const hp = part.ps[hovIdx];
        if (hp?.bm) {
          if (!xraySilRef.current) xraySilRef.current = mkCanvas(pc.width, pc.height);
          if (!xrayOutRef.current) xrayOutRef.current = mkCanvas(pc.width, pc.height);
          const ho = 6 * hovIdx;
          renderGreenXRayCutout(pg, xraySilRef.current, xrayOutRef.current, pc.width, pc.height, dpr, (g) => {
            g.setTransform(
              pz * W[ho],
              pz * W[ho + 1],
              pz * W[ho + 2],
              pz * W[ho + 3],
              pz * W[ho + 4] + pox,
              pz * W[ho + 5] + poy,
            );
            g.drawImage(hp.bm!, hp.x, hp.y, hp.w, hp.h);
          });
        }
      }

      pg.setTransform(1, 0, 0, 1, 0, 0);
      pg.lineWidth = 1.5 * dpr;
      pg.strokeStyle = 'rgba(34, 197, 94, 0.52)';
      pg.beginPath();
      for (let k = 0; k < part.ps.length; k++) {
        const q = part.par[k];
        if (q < 0 || !part.on[k] || !part.on[q]) continue;
        const a = cen(part, q);
        const b = cen(part, k);
        pg.moveTo(a[0] * pz + pox, a[1] * pz + poy);
        pg.lineTo(b[0] * pz + pox, b[1] * pz + poy);
      }
      pg.stroke();

      if (part.id === 'head') {
        const ck = part.ps.findIndex((p) => p.name === 'Chin');
        if (ck >= 0) {
          const c = cen(part, ck);
          pg.strokeStyle = GREEN;
          pg.lineWidth = 2 * dpr;
          pg.beginPath();
          pg.arc(c[0] * pz + pox, c[1] * pz + poy, 13 * dpr, 0, Math.PI * 2);
          pg.stroke();
          pg.lineWidth = 1.5 * dpr;
        }
      }

      for (let k = 0; k < part.ps.length; k++) {
        if (!part.on[k]) continue;
        const p = part.ps[k];
        const c = cen(part, k);
        const x = c[0] * pz + pox;
        const y = c[1] * pz + poy;
        const L = Math.max(p.w, p.h) * 0.3 * pz;
        const a = Math.atan2(W[6 * k + 1], W[6 * k]) + (p.h > p.w ? Math.PI / 2 : 0);
        const s = k === activeIdx;
        const h = k === hovIdx;

        pg.strokeStyle = s ? MAGENTA : GREEN;
        pg.lineWidth = (h ? 2.5 : 1.5) * dpr;
        pg.beginPath();
        pg.moveTo(x - Math.cos(a) * L, y - Math.sin(a) * L);
        pg.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
        pg.stroke();

        pg.fillStyle = s ? MAGENTA : GREEN;
        pg.beginPath();
        pg.arc(x, y, (s ? 7 : h ? 6 : 4) * dpr, 0, Math.PI * 2);
        pg.fill();
      }

      if (hovIdx !== null && part.on[hovIdx]) {
        const c = cen(part, hovIdx);
        const sx = c[0] * pz + pox;
        const sy = c[1] * pz + poy;
        const occluded = isLayerOccludedInStack(part, hovIdx);
        const outOfView = sx < 0 || sy < 0 || sx > pc.width || sy > pc.height;
        if (occluded || outOfView) {
          const pad = 16 * dpr;
          const cx = Math.max(pad, Math.min(pc.width - pad, sx));
          const cy = Math.max(pad, Math.min(pc.height - pad, sy));
          pg.fillStyle = 'rgba(239, 68, 68, 0.16)';
          pg.beginPath();
          pg.arc(cx, cy, 12 * dpr, 0, Math.PI * 2);
          pg.fill();
          pg.strokeStyle = '#ef4444';
          pg.lineWidth = 2.2 * dpr;
          pg.beginPath();
          pg.arc(cx, cy, 12 * dpr, 0, Math.PI * 2);
          pg.stroke();
        }
      }
    },
    [cen, hoveredIdx, isLayerOccludedInStack, part, selectedIdx],
  );

  const fitPartCanvas = useCallback(() => {
    const pc = canvasRef.current;
    if (!pc || !part) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pc.width = pc.clientWidth * dpr;
    pc.height = pc.clientHeight * dpr;
    const q = part.ps.filter((_p, k) => part.on0[k]);
    const x0 = Math.min(...q.map((p) => p.x));
    const y0 = Math.min(...q.map((p) => p.y));
    const x1 = Math.max(...q.map((p) => p.x + p.w));
    const y1 = Math.max(...q.map((p) => p.y + p.h));
    const pz = Math.min(pc.width / (x1 - x0), pc.height / (y1 - y0)) * 0.9;
    viewRef.current = {
      z: pz,
      ox: (pc.width - (x1 - x0) * pz) / 2 - x0 * pz,
      oy: (pc.height - (y1 - y0) * pz) / 2 - y0 * pz,
      dpr,
    };
    drawPart();
  }, [drawPart, part]);

  useEffect(() => {
    if (!part) return;
    setSelectedIdx(0);
    setHoveredIdx(null);
    setAngleVal(Math.round(part.ang[0] || 0));
    setFlipVal(part.flip);
    fitPartCanvas();

    const pc = canvasRef.current;
    if (!pc) return;
    const ro = new ResizeObserver(() => fitPartCanvas());
    ro.observe(pc);
    return () => ro.disconnect();
  }, [fitPartCanvas, part]);

  useEffect(() => {
    if (!part) return;
    drawPart(selectedIdx, hoveredIdx);
  }, [drawPart, hoveredIdx, part, selectedIdx, angleVal, flipVal]);

  if (!part) return null;

  const toCanvasPts = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const pc = canvasRef.current!;
    const r = pc.getBoundingClientRect();
    const d = pc.width / r.width;
    return [(e.clientX - r.left) * d, (e.clientY - r.top) * d];
  };

  const hitPartAtPoint = (q: [number, number]): number => {
    PartRigManager.pfk(part);
    const { z: pz, ox: pox, oy: poy, dpr } = viewRef.current;
    let best = -1;
    let bd = 26 * dpr;
    for (let k = 0; k < part.ps.length; k++) {
      if (!part.on[k]) continue;
      const c = cen(part, k);
      const d = Math.hypot(c[0] * pz + pox - q[0], c[1] * pz + poy - q[1]);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best < 0) {
      const X = (q[0] - pox) / pz;
      const Y = (q[1] - poy) / pz;
      const W = part.W;
      for (let k = 0; k < part.ps.length && best < 0; k++) {
        if (!part.on[k]) continue;
        const p = part.ps[k];
        const o = 6 * k;
        const det = W[o] * W[o + 3] - W[o + 1] * W[o + 2];
        if (!det) continue;
        const lx = (W[o + 3] * (X - W[o + 4]) - W[o + 2] * (Y - W[o + 5])) / det;
        const ly = (-W[o + 1] * (X - W[o + 4]) + W[o] * (Y - W[o + 5])) / det;
        if (lx >= p.x && lx <= p.x + p.w && ly >= p.y && ly <= p.y + p.h) {
          best = k;
        }
      }
    }
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pc = canvasRef.current;
    if (!pc) return;
    pc.setPointerCapture(e.pointerId);
    const { z: pz, ox: pox, oy: poy } = viewRef.current;
    const q = toCanvasPts(e);
    const best = hitPartAtPoint(q);
    if (best < 0) return;
    setSelectedIdx(best);
    setAngleVal(Math.round(part.ang[best]));
    const c = cen(part, best);
    dragRef.current = {
      a0: part.ang[best],
      s: Math.atan2(q[1] - (c[1] * pz + poy), q[0] - (c[0] * pz + pox)),
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const q = toCanvasPts(e);
    if (!dragRef.current) {
      const hit = hitPartAtPoint(q);
      const next = hit >= 0 ? hit : null;
      if (next !== hoveredIdx) {
        setHoveredIdx(next);
      }
      return;
    }
    PartRigManager.pfk(part);
    const { z: pz, ox: pox, oy: poy } = viewRef.current;
    const c = cen(part, selectedIdx);
    const a =
      dragRef.current.a0 +
      (Math.atan2(q[1] - (c[1] * pz + poy), q[0] - (c[0] * pz + pox)) - dragRef.current.s) / DEG;
    const norm = ((a + 540) % 360) - 180;
    part.ang[selectedIdx] = norm;
    setAngleVal(Math.round(norm));
    onMutated(part);
    drawPart(selectedIdx, hoveredIdx);
  };

  return (
    <div className="fixed inset-[3%] z-40 flex flex-col overflow-hidden rounded-lg border border-[#2b2f36] bg-[#191b1f] shadow-[0_12px_48px_rgba(0,0,0,0.75)] md:flex-row">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerLeave={() => setHoveredIdx(null)}
        className="h-[62%] min-w-0 flex-1 cursor-crosshair touch-none bg-[#121315] md:h-full"
      />

      <aside className="flex h-[38%] flex-col gap-2.5 overflow-y-auto border-t border-[#2b2f36] bg-[#191b1f] p-3 md:h-full md:w-[270px] md:border-t-0 md:border-l">
        <div className="flex items-center justify-between gap-2 border-b border-[#2b2f36] pb-2">
          <div className="truncate font-semibold text-[#e6e8ec]">
            {part.title} <span className="text-[#8b919c]">· {part.id}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                part.reset();
                setAngleVal(0);
                setFlipVal(0);
                onMutated(part);
                drawPart(selectedIdx, hoveredIdx);
                setTick((t) => t + 1);
              }}
              className="rounded border border-[#ff3b6b]/45 bg-[#ff3b6b]/10 px-2 py-0.5 text-[11.5px] text-[#ff6b8f] hover:border-[#ff3b6b]"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[#10b981]/50 bg-[#10b981]/15 px-2 py-0.5 text-[11.5px] font-medium text-[#34d399] hover:bg-[#10b981]/25"
            >
              Close
            </button>
          </div>
        </div>

        {part.id === 'head' && (
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#c7cbd3]">
            <input
              type="checkbox"
              checked={!!flipVal}
              onChange={(e) => {
                part.flip = e.target.checked ? 1 : 0;
                setFlipVal(part.flip);
                onMutated(part);
                drawPart(selectedIdx, hoveredIdx);
              }}
              className="accent-[#a855f7]"
            />
            <span>flip face (side pose)</span>
          </label>
        )}

        <div className="flex items-center gap-2 text-[12px] text-[#c7cbd3]">
          <span className="shrink-0">bone angle</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={angleVal}
            onChange={(e) => {
              const v = +e.target.value;
              part.ang[selectedIdx] = v;
              setAngleVal(v);
              onMutated(part);
              drawPart(selectedIdx, hoveredIdx);
            }}
            className="studio-range flex-1"
          />
          <span className="font-mono-tabular w-9 text-right text-[11px] text-[#e6e8ec]">{angleVal}°</span>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto pt-1">
          {part.tree.map(({ k, d }) => {
            const p = part.ps[k];
            const active = k === selectedIdx;
            const isHinge = part.id === 'head' && FACE.hinge.includes(p.name);
            return (
              <div
                key={k}
                style={{ paddingLeft: `${d * 12}px` }}
                onMouseEnter={() => setHoveredIdx(k)}
                onMouseLeave={() => setHoveredIdx((prev) => (prev === k ? null : prev))}
                className="flex items-center gap-1.5 text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={!!part.on[k]}
                  onChange={(e) => {
                    part.on[k] = e.target.checked ? 1 : 0;
                    onMutated(part);
                    drawPart(selectedIdx, hoveredIdx);
                    setTick((t) => t + 1);
                  }}
                  className="accent-[#10b981]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIdx(k);
                    setAngleVal(Math.round(part.ang[k]));
                  }}
                  className={`flex-1 truncate rounded border px-1.5 py-0.5 text-left transition-colors ${
                    active
                      ? 'border-[#a855f7] bg-[#7e22ce] text-white'
                      : 'border-transparent text-[#c7cbd3] hover:border-[#10b981]/60 hover:text-[#34d399]'
                  }`}
                >
                  {d > 0 ? '└ ' : ''}
                  {isHinge ? '◉ ' : ''}
                  {p.name}
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
};
