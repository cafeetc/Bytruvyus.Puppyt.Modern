export type RenderMode = 'A' | 'D';

export type PanelId = 'pose' | 'bones' | 'tl' | 'library' | 'data' | 'roadmap' | 'about';

export type EffectorRole = 'handL' | 'handR' | 'footL' | 'footR' | 'head' | null;

export interface AimConstraint {
  to: string;
  from: [number, number];
  min: number;
  max: number;
}

export interface RawPieceDef {
  i: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
}

export interface RawNodeDef {
  id: string;
  name?: string;
  parent?: string | null;
  pivot: [number, number];
  aim?: AimConstraint | null;
  ang?: number;
  top?: number;
  left?: number;
  pieces?: RawPieceDef[];
  lock?: boolean | number;
  ghost?: boolean | number;
  bar?: [string, string] | null;
  flipX?: boolean;
}

export interface RawRigDef {
  W: number;
  H: number;
  nodes: RawNodeDef[];
  dg?: number;
  jn?: number;
}

export interface RawPartPiece {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  on?: boolean | number;
  bm?: ImageBitmap | HTMLImageElement;
}

export interface RawPartDef {
  title: string;
  views: Array<{
    pieces: RawPartPiece[];
  }>;
}

export type PartsManifest = Record<'head' | 'hand' | 'foot', RawPartDef>;

export interface RigPiece {
  i: number;
  i0?: number;
  wing?: boolean;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
  node?: RigNode;
  bm?: CanvasImageSource;
  bm0?: CanvasImageSource;
  full0?: CanvasImageSource;
  sib?: [RigPiece, RigPiece];
  mir?: boolean;
  m?: Uint8Array;
  mw?: number;
  mh?: number;
  st?: number;
}

export interface RigNode {
  id: string;
  name: string;
  parent: string | null;
  aim: AimConstraint | null;
  pieces: RigPiece[];
  piv: [number, number];
  rest: [number, number];
  ang: number;
  tx: number;
  ty: number;
  w: Float64Array;
  eff: number;
  bond: RigNode | null;
  lock: boolean;
  ghost: boolean;
  bar: [string, string] | null;
  at: [number, number] | null;
  // IK-ready dormant base metadata (no active IK solver in base stage)
  limits: [number, number];
  effectorRole: EffectorRole;
  chainId: string | null;
  flipX?: boolean;
}

export interface LimbChainDef {
  id: string;
  label: string;
  swiv?: string;
  upper: string;
  lower: string;
  effector: string;
  bendSign: number;
}

export type AbcSlot = 'A' | 'B' | 'C' | 'D' | 'E';

export type AbcLoopMode = 'pingpong' | 'cycle';

export type MotionFeel = 'flow' | 'snap' | 'elastic' | 'mechanical' | 'clockwork';

export interface MotionSettings {
  easing: number;       // 0..1 tension easing for Snap
  anticipation: number; // 0..0.35 wind-up coil before release
  stagger: number;      // 0..0.45 hierarchical core-to-distal phase stagger
  bounce: number;       // 0..1 Elastic overshoot amplitude & harmonic count
  damping: number;      // 0..1 Elastic settling tightness
  torque: number;       // 0..1 Mechanical cam crispness, detent & escapement jitter
  teeth: number;        // 3..16 Clockwork gear teeth per transition
  pawlSnap: number;     // 0..1 Clockwork brass pawl lock-in snap
}

export interface Keyframe {
  f: number;
  a: number[];
  x: number;
  y: number;
  s?: Record<string, number[]>;
}

export interface PartSerializedState {
  flip: number;
  on: number[];
  ang: number[];
  dx: number[];
  dy: number[];
}

export interface AbcPoseRecord {
  nodes: Record<string, number>;
  root: [number, number];
  flipX?: Record<string, boolean>;
  parts?: Record<string, PartSerializedState>;
}

export interface SavedPoseEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  prometheusWings?: boolean;
  pose: AbcPoseRecord;
}

export interface AbcSerializedState {
  poses: Record<AbcSlot, AbcPoseRecord | null>;
  activeSlot: AbcSlot;
  loopMode: AbcLoopMode;
  feel: MotionFeel;
  snapFrames: number;
  fps: number;
  steppedFps: boolean;
  ghostVisible: boolean;
  ghostOpacity: number;
  settings: MotionSettings;
}

export interface PoseSnapshot {
  pose: Record<string, number>;
  coords?: Record<string, [number, number]>;
  keys: Array<{ f: number; a: number[]; x?: number; y?: number; s?: Record<string, number[]> }>;
  root: [number, number];
  prometheusWings?: boolean;
  flipX?: Record<string, boolean>;
  parts?: Record<string, PartSerializedState>;
  abc?: AbcSerializedState;
}

export interface PartRigInstance {
  id: string;
  key: 'head' | 'hand' | 'foot';
  fp: RigPiece;
  ps: RawPartPiece[];
  m: number[];
  par: Int16Array;
  pv: Float32Array;
  ord: number[];
  tree: Array<{ k: number; d: number }>;
  W: Float64Array;
  flip: number;
  title: string;
  on0: number[];
  on: Uint8Array;
  ang: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
  touched: number;
  h: string;
  q: number;
  reset: () => void;
}

export interface CameraBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BondStatusItem {
  side: string;
  delta: number;
  strained: boolean;
}

export interface HudTelemetry {
  ms: number;
  drawn: number;
  culled: number;
  bones: number;
  idle: boolean;
  zoomPct: number;
  bondStatus: BondStatusItem[];
}
