import { clampAnatomicalAngle, clampRealisticShoulder, normalizeDeg } from './fkEngine';
import type {
  AbcLoopMode,
  AbcPoseRecord,
  AbcSerializedState,
  AbcSlot,
  MotionFeel,
  MotionSettings,
  PartRigInstance,
  PartSerializedState,
  RigNode,
} from './types';

export const ABC_SLOTS: AbcSlot[] = ['A', 'B', 'C', 'D', 'E'];
export const FPS_PRESETS = [6, 8, 12, 24, 30, 60] as const;

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  easing: 0.55,
  anticipation: 0.16,
  stagger: 0.16,
  bounce: 0.62,
  damping: 0.42,
  torque: 0.72,
  teeth: 8,
  pawlSnap: 0.7,
};

export function createDefaultAbcState(): AbcSerializedState {
  return {
    poses: { A: null, B: null, C: null, D: null, E: null },
    activeSlot: 'A',
    loopMode: 'pingpong',
    feel: 'snap',
    snapFrames: 6,
    fps: 12,
    steppedFps: true,
    ghostVisible: true,
    ghostOpacity: 0.34,
    settings: { ...DEFAULT_MOTION_SETTINGS },
  };
}

export function getAbcNodeLag(id: string): number {
  if (
    id === 'head' ||
    id === 'lip' ||
    id === 'handL' ||
    id === 'handR' ||
    id === 'thumbL' ||
    id === 'thumbR' ||
    id === 'fingerL' ||
    id === 'fingerR' ||
    id === 'footL' ||
    id === 'footR' ||
    id === 'braceL' ||
    id === 'braceR'
  ) {
    return 0.085;
  }
  if (
    id === 'shinL' ||
    id === 'shinR' ||
    id === 'forearmL' ||
    id === 'forearmR' ||
    id === 'acromionL' ||
    id === 'acromionR'
  ) {
    return 0.045;
  }
  if (id === 'humerusL' || id === 'humerusR' || id === 'femurL' || id === 'femurR' || id === 'swivelL' || id === 'swivelR') {
    return 0.022;
  }
  return 0;
}

export function evalCubicBezier(u: number, cx1: number, cy1: number, cx2: number, cy2: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * cx1 + 3 * (1 - t) * t * t * cx2 + t * t * t;
  const dbx = (t: number) => 3 * (1 - t) * (1 - t) * cx1 + 6 * (1 - t) * t * (cx2 - cx1) + 3 * t * t * (1 - cx2);
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * cy1 + 3 * (1 - t) * t * t * cy2 + t * t * t;

  let t = u;
  for (let i = 0; i < 5; i++) {
    const err = bx(t) - u;
    if (Math.abs(err) < 1e-4) return by(t);
    const d = dbx(t);
    if (Math.abs(d) < 1e-5) break;
    t = Math.max(0, Math.min(1, t - err / d));
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) * 0.5;
    if (bx(mid) < u) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) * 0.5);
}

/**
 * Precision brass gear & escapement pawl ratchet curve.
 * Each tooth engages briskly during `0..engageEnd`, then seats against the pawl with a micro-tick.
 */
export function evalClockGearCurve(kNode: number, teeth: number, pawlSnap = 0.7): number {
  if (kNode <= 0) return 0;
  if (kNode >= 1) return 1;
  const nTeeth = Math.max(2, Math.round(teeth));
  const p = kNode * nTeeth;
  const idx = Math.floor(p);
  const sub = p - idx;
  const engageEnd = 0.58 - pawlSnap * 0.32; // 0.26..0.58
  const tickAmp = 0.014 + pawlSnap * 0.048;
  const toothFrac =
    sub < engageEnd
      ? 1 - Math.pow(1 - sub / engageEnd, 3)
      : 1 + Math.sin(Math.min(1, (sub - engageEnd) / 0.34) * Math.PI) * tickAmp;
  return Math.min(1.03, (idx + toothFrac) / nTeeth);
}

export function captureAbcPose(
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
): AbcPoseRecord {
  const nodeAngles: Record<string, number> = {};
  const flipX: Record<string, boolean> = {};
  for (const n of nodes) {
    nodeAngles[n.id] = n.ang;
    if (n.flipX) flipX[n.id] = true;
  }
  const parts: Record<string, PartSerializedState> = {};
  for (const id in instMap) {
    const I = instMap[id];
    if (I.touched) {
      parts[id] = {
        flip: I.flip,
        on: Array.from(I.on),
        ang: Array.from(I.ang),
        dx: Array.from(I.dx),
        dy: Array.from(I.dy),
      };
    }
  }
  return {
    nodes: nodeAngles,
    root: [root.tx, root.ty],
    ...(Object.keys(flipX).length ? { flipX } : {}),
    ...(Object.keys(parts).length ? { parts } : {}),
  };
}

export function applyAbcPoseInstant(
  pose: AbcPoseRecord,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
): void {
  for (const n of nodes) {
    if (pose.nodes && n.id in pose.nodes) {
      n.ang = pose.nodes[n.id];
    }
    n.flipX = !!(pose.flipX && pose.flipX[n.id]);
  }
  root.tx = pose.root?.[0] ?? 0;
  root.ty = pose.root?.[1] ?? 0;

  for (const id in instMap) {
    const I = instMap[id];
    const saved = pose.parts?.[id];
    if (saved) {
      I.on.set(saved.on);
      I.ang.set(saved.ang);
      I.dx.set(saved.dx || []);
      I.dy.set(saved.dy || []);
      I.flip = saved.flip | 0;
      I.touched = 1;
      rebakeFn(I);
    } else if (I.touched) {
      I.reset();
    }
  }
}

export function getFilledAbcSlots(poses: Record<AbcSlot, AbcPoseRecord | null>): AbcSlot[] {
  return ABC_SLOTS.filter((s) => !!poses[s]);
}

export function nextAbcSlot(
  poses: Record<AbcSlot, AbcPoseRecord | null>,
  activeSlot: AbcSlot,
  loopMode: AbcLoopMode,
  loopDir: 1 | -1,
  mutateDir?: (dir: 1 | -1) => void,
): AbcSlot | null {
  const filled = getFilledAbcSlots(poses);
  if (filled.length < 2) return filled[0] ?? null;

  const idx = filled.indexOf(activeSlot);
  if (idx === -1) {
    mutateDir?.(1);
    return filled[0];
  }

  if (loopMode === 'cycle' || filled.length === 2) {
    return filled[(idx + 1) % filled.length];
  }

  // Ping-pong cleanly across any 3..5 filled poses
  if (idx <= 0) {
    mutateDir?.(1);
    return filled[1];
  }
  if (idx >= filled.length - 1) {
    mutateDir?.(-1);
    return filled[filled.length - 2];
  }
  return filled[idx + loopDir];
}

export function getAbcCycleSequence(
  poses: Record<AbcSlot, AbcPoseRecord | null>,
  loopMode: AbcLoopMode,
): Array<[AbcSlot, AbcSlot]> {
  const filled = getFilledAbcSlots(poses);
  if (filled.length < 2) return [];
  if (filled.length === 2) {
    return [
      [filled[0], filled[1]],
      [filled[1], filled[0]],
    ];
  }
  if (loopMode === 'cycle') {
    return filled.map((slot, i) => [slot, filled[(i + 1) % filled.length]]);
  }
  const seq: Array<[AbcSlot, AbcSlot]> = [];
  for (let i = 0; i < filled.length - 1; i++) {
    seq.push([filled[i], filled[i + 1]]);
  }
  for (let i = filled.length - 1; i > 0; i--) {
    seq.push([filled[i], filled[i - 1]]);
  }
  return seq;
}

function getEffectiveAnticipation(feel: MotionFeel, settings: MotionSettings): number {
  if (feel === 'flow') return 0;
  if (feel === 'snap') {
    return settings.easing > 0.06 ? Math.min(0.35, settings.anticipation * (0.4 + 0.9 * settings.easing)) : 0;
  }
  return Math.max(0, Math.min(0.35, settings.anticipation));
}

/**
 * Evaluates a normalized curve value (where 0 = fromPose, 1 = toPose) for preview SVG & pose blending.
 */
export function evalMotionScalar(
  tRaw: number,
  feel: MotionFeel,
  settings: MotionSettings,
  nodeLag = 0,
  nodeIndex = 0,
): { s: number; ease: number; jitterDeg: number; inAnticipation: boolean; antBell: number; antPull: number } {
  const t = Math.max(0, Math.min(1, tRaw));
  const antFrac = getEffectiveAnticipation(feel, settings);

  if (antFrac > 0.005 && t < antFrac) {
    const u = t / antFrac;
    const bell = Math.pow(Math.sin(u * Math.PI), 0.68);
    const strength =
      feel === 'elastic'
        ? 0.14 + settings.bounce * 0.22
        : feel === 'clockwork'
        ? 0.1 + settings.pawlSnap * 0.16
        : feel === 'mechanical'
        ? 0.08 + settings.torque * 0.14
        : 0.08 + settings.easing * 0.24;
    const pull = -strength * bell;
    return { s: pull, ease: pull, jitterDeg: 0, inAnticipation: true, antBell: bell, antPull: pull };
  }

  const k = t >= 1 ? 1 : Math.min(1, (t - antFrac) / Math.max(0.01, 1 - antFrac));

  let scaledLag = 0;
  if (feel === 'snap') {
    scaledLag = nodeLag * 0.45 * settings.easing;
  } else if (feel === 'elastic') {
    scaledLag = Math.min(0.55, nodeLag * (1 + settings.stagger * 3.8));
  } else if (feel === 'mechanical') {
    scaledLag = Math.min(0.55, nodeLag * (0.6 + settings.stagger * 4.5));
  } else if (feel === 'clockwork') {
    scaledLag = Math.min(0.55, nodeLag * (0.45 + settings.stagger * 4.2));
  }

  const kNode = k >= 1 ? 1 : Math.max(0, Math.min(1, (k - scaledLag) / Math.max(0.05, 1 - scaledLag)));

  if (k >= 1) {
    return { s: 1, ease: 1, jitterDeg: 0, inAnticipation: false, antBell: 0, antPull: 0 };
  }

  let eNode = kNode;
  let over = 0;
  let jitterDeg = 0;

  if (feel === 'flow') {
    eNode = kNode;
  } else if (feel === 'snap') {
    const e = settings.easing;
    eNode = evalCubicBezier(kNode, 0.16 + 0.68 * e, 0.0, 0.14 + 0.14 * (1 - e), 1.0);
    over = Math.sin(kNode * Math.PI * 2.1) * Math.exp(-3.8 * kNode) * (0.015 + 0.105 * e);
  } else if (feel === 'elastic') {
    const b = settings.bounce;
    const d = settings.damping;
    eNode = 1 - Math.pow(1 - kNode, 3.35);
    const amp = (0.06 + b * 0.28) * (1 + nodeLag * 3.6);
    const cycles = 2.0 + b * 2.1;
    const decay = 5.4 - (1 - d) * 2.9;
    over =
      (Math.sin(kNode * Math.PI * cycles) + 0.24 * Math.sin(kNode * Math.PI * cycles * 1.85)) *
      Math.exp(-decay * kNode) *
      amp;
  } else if (feel === 'mechanical') {
    const tq = settings.torque;
    eNode = evalCubicBezier(kNode, 0.7 + 0.18 * tq, 0.0, 0.3 - 0.16 * tq, 1.0);
    // Crisp detent latch micro-rebound near end of stroke
    if (kNode > 0.82) {
      const dU = (kNode - 0.82) / 0.18;
      over = -Math.sin(dU * Math.PI) * (0.012 + tq * 0.035);
    }
    const env = Math.sin(kNode * Math.PI);
    jitterDeg = Math.sin(k * Math.PI * (8 + tq * 10) + nodeIndex * 1.17) * env * (0.45 + tq * 1.65);
  } else if (feel === 'clockwork') {
    eNode = evalClockGearCurve(kNode, settings.teeth, settings.pawlSnap);
  }

  return {
    s: eNode + over,
    ease: eNode,
    jitterDeg,
    inAnticipation: false,
    antBell: 0,
    antPull: 0,
  };
}

export function applyAbcTweenPose(
  fromPose: AbcPoseRecord,
  toPose: AbcPoseRecord,
  tRaw: number,
  feel: MotionFeel,
  settings: MotionSettings,
  nodes: RigNode[],
  root: RigNode,
  instMap: Record<string, PartRigInstance>,
  rebakeFn: (I: PartRigInstance) => void,
  constrainLimits: boolean,
  by?: Record<string, RigNode>,
  prometheusWings = false,
): void {
  const t = Math.max(0, Math.min(1, tRaw));

  if (t >= 1) {
    applyAbcPoseInstant(toPose, nodes, root, instMap, rebakeFn);
    if (by && !prometheusWings) {
      nodes.forEach((n) => {
        n.ang = clampRealisticShoulder(n, n.ang, by, false);
      });
    }
    return;
  }
  if (t <= 0) {
    applyAbcPoseInstant(fromPose, nodes, root, instMap, rebakeFn);
    if (by && !prometheusWings) {
      nodes.forEach((n) => {
        n.ang = clampRealisticShoulder(n, n.ang, by, false);
      });
    }
    return;
  }

  const antScale =
    feel === 'elastic'
      ? 0.65 + settings.bounce * 0.7
      : feel === 'clockwork'
      ? 0.5 + settings.pawlSnap * 0.6
      : feel === 'mechanical'
      ? 0.45 + settings.torque * 0.55
      : 0.45 + settings.easing * 0.85;

  nodes.forEach((n, ni) => {
    const a = fromPose.nodes[n.id] ?? 0;
    const b = toPose.nodes[n.id] ?? 0;
    const da = normalizeDeg(b - a);
    const sample = evalMotionScalar(t, feel, settings, getAbcNodeLag(n.id), ni);

    n.flipX = t >= 0.5 ? !!(toPose.flipX && toPose.flipX[n.id]) : !!(fromPose.flipX && fromPose.flipX[n.id]);

    if (sample.inAnticipation) {
      let extra = 0;
      if (n.id === 'lumbar') extra = 3.6 * sample.antBell;
      else if (n.id === 'thorax') extra = -4.8 * sample.antBell;
      else if (n.id === 'neck') extra = 3.0 * sample.antBell;
      const next = clampAnatomicalAngle(n, a + da * sample.antPull + extra * antScale, constrainLimits);
      n.ang = by ? clampRealisticShoulder(n, next, by, prometheusWings) : next;
    } else {
      const next = clampAnatomicalAngle(n, a + da * sample.s + sample.jitterDeg, constrainLimits);
      n.ang = by ? clampRealisticShoulder(n, next, by, prometheusWings) : next;
    }
  });

  const rootSample = evalMotionScalar(t, feel, settings, 0, 0);
  const rx0 = fromPose.root?.[0] ?? 0;
  const ry0 = fromPose.root?.[1] ?? 0;
  const rx1 = toPose.root?.[0] ?? 0;
  const ry1 = toPose.root?.[1] ?? 0;

  if (rootSample.inAnticipation) {
    root.tx = rx0 + (rx1 - rx0) * rootSample.antPull;
    root.ty = ry0 + (ry1 - ry0) * rootSample.antPull + 28 * antScale * rootSample.antBell;
  } else {
    const tScale = Math.max(-0.22, Math.min(1.16, rootSample.s));
    root.tx = rx0 + (rx1 - rx0) * tScale;
    root.ty = ry0 + (ry1 - ry0) * tScale;
  }

  // Interpolate sub-rig parts (head/hand/foot) cleanly
  for (const id in instMap) {
    const I = instMap[id];
    const pa = fromPose.parts?.[id];
    const pb = toPose.parts?.[id];
    if (!pa && !pb) continue;
    const len = I.ang.length;
    const angA = pa?.ang ?? new Array(len).fill(0);
    const angB = pb?.ang ?? new Array(len).fill(0);
    const blend = Math.max(0, Math.min(1, rootSample.inAnticipation ? 0 : rootSample.s));
    for (let k = 0; k < len; k++) {
      const a0 = angA[k] ?? 0;
      const a1 = angB[k] ?? 0;
      I.ang[k] = a0 + normalizeDeg(a1 - a0) * blend;
    }
    const targetMask = t >= 0.5 ? pb : pa;
    if (targetMask) {
      I.on.set(targetMask.on);
      I.flip = targetMask.flip | 0;
    }
    I.touched = 1;
    rebakeFn(I);
  }
}

export function sampleMotionCurvePath(
  feel: MotionFeel,
  settings: MotionSettings,
  steps = 64,
): Array<{ u: number; y: number }> {
  const pts: Array<{ u: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const res = evalMotionScalar(u, feel, settings, 0, 0);
    pts.push({ u, y: res.s });
  }
  return pts;
}
