/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FloatingPanel, type PanelLayoutState } from './components/FloatingPanel';
import {
  AboutPanel,
  BonesPanel,
  DataPanel,
  PoseLibraryPanel,
  PosePanel,
  RoadmapPanel,
  TimelinePanel,
} from './components/Panels';
import { PartRigModal } from './components/PartRigModal';
import { TopToolbar } from './components/TopToolbar';
import { StageRenderer, type AbcGhostItem } from './engine/canvasRenderer';
import {
  DEG,
  applyPoseSnapshot,
  buildRigGraph,
  capturePoseSnapshot,
  clampAnatomicalAngle,
  clampRealisticShoulder,
  computeModelFrame,
  decImage,
  exportBskJson,
  getBondStatus,
  hitTest,
  hitTestPiece,
  normalizeDeg,
  parentOf,
  parseBskJson,
  pos,
  setPieceBitmap,
  solveRig,
  sortPiecesForWings,
} from './engine/fkEngine';
import {
  ABC_SLOTS,
  DEFAULT_MOTION_SETTINGS,
  applyAbcPoseInstant,
  applyAbcTweenPose,
  captureAbcPose,
  createDefaultAbcState,
  evalMotionScalar,
  getAbcCycleSequence,
  getAbcNodeLag,
  getFilledAbcSlots,
  nextAbcSlot,
} from './engine/motionEngine';
import { PartRigManager } from './engine/partRigEngine';
import type {
  AbcLoopMode,
  AbcPoseRecord,
  AbcSerializedState,
  AbcSlot,
  BondStatusItem,
  Keyframe,
  MotionFeel,
  MotionSettings,
  PanelId,
  PartRigInstance,
  PartsManifest,
  PoseSnapshot,
  RawRigDef,
  RenderMode,
  RigNode,
  RigPiece,
  SavedPoseEntry,
} from './engine/types';

const STORAGE_KEY = 'bpz_v1';
const POSE_LIBRARY_KEY = 'bpz_pose_library_v1';

interface RigRuntime {
  W: number;
  H: number;
  nodes: RigNode[];
  by: Record<string, RigNode>;
  root: RigNode;
  pieces: RigPiece[];
  sel: RigNode;
  hov: RigNode | null;
  z: number;
  ox: number;
  oy: number;
  dpr: number;
  userView: boolean;
  mode: RenderMode;
  showBones: boolean;
  showGuides: boolean;
  bondOn: boolean;
  constrainLimits: boolean;
  prometheusWings: boolean;
  wingPop: number;
  wingTarget: number;
  dirty: boolean;
  raf: number;
  actUntil: number;
  playing: boolean;
  loop: boolean;
  fps: number;
  frame: number;
  t0: number;
  keys: Keyframe[];
  ema: number;
  hudT: number;
}

const DEFAULT_PANELS: Record<PanelId, PanelLayoutState> = {
  pose: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 31 },
  bones: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 32 },
  tl: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 33 },
  library: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 34 },
  data: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 35 },
  roadmap: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 36 },
  about: { open: false, collapsed: false, floating: false, x: 24, y: 72, zIndex: 37 },
};

function loadInitialPanels(): Record<PanelId, PanelLayoutState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANELS;
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_PANELS };
    (Object.keys(DEFAULT_PANELS) as PanelId[]).forEach((id) => {
      if (parsed[id]) {
        out[id] = { ...DEFAULT_PANELS[id], ...parsed[id] };
      }
    });
    return out;
  } catch {
    return DEFAULT_PANELS;
  }
}

function loadPoseLibrary(): SavedPoseEntry[] {
  try {
    const raw = localStorage.getItem(POSE_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef(new StageRenderer());
  const partMgrRef = useRef<PartRigManager | null>(null);
  const rawBaseRigRef = useRef<RawRigDef | null>(null);
  const rtRef = useRef<RigRuntime | null>(null);
  const dragRef = useRef<
    | { t: 'pan'; x: number; y: number; ox: number; oy: number }
    | { t: 'rot'; a0: number; s: number; rawAng: number; parDetSign: number }
    | {
        t: 'hipSwivel';
        side: 'L' | 'R';
        sAng: number;
        hip0: number;
        femur0: number;
        shin0: number;
        foot0: number;
        flipped0: boolean;
      }
    | {
        t: 'shoulder';
        side: 'L' | 'R';
        guide: 'wing' | 'tendon' | 'acromion' | 'prometheus';
        sSwivel: number;
        sNeck: number;
        swivel0: number;
        acro0: number;
        brace0: number;
      }
    | null
  >(null);
  const rightClickRef = useRef<{ count: number; timer: number }>({ count: 0, timer: 0 });
  const zCounterRef = useRef(40);
  const jsonEditingRef = useRef(false);
  const benchmarkMsgRef = useRef(false);
  const copyToastTimerRef = useRef(0);
  const abcRef = useRef<AbcSerializedState>(createDefaultAbcState());
  const abcPlayingRef = useRef(false);
  const abcLoopDirRef = useRef<1 | -1>(1);
  const abcPlayTimerRef = useRef(0);
  const abcScrubRef = useRef(0);
  const sidePoseRef = useRef<'L' | 'R' | null>(null);
  const snapSpringRef = useRef<{
    fromAngles: Record<string, number>;
    toAngles: Record<string, number>;
    t0: number;
    dur: number;
  } | null>(null);
  const abcAnimRef = useRef<{
    fromPose: AbcPoseRecord;
    toPose: AbcPoseRecord;
    toSlot: AbcSlot;
    t0: number;
    dur: number;
    totalF: number;
    fpsPeriod: number;
    lastIdx: number;
    isLoop?: boolean;
    onDone?: () => void;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<PanelId, PanelLayoutState>>(loadInitialPanels);
  const [showStats, setShowStats] = useState(false);
  const [hudText, setHudText] = useState('');
  const [hintVisible, setHintVisible] = useState(true);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [activePart, setActivePart] = useState<PartRigInstance | null>(null);
  const [abcPlaying, setAbcPlaying] = useState(false);
  const [unlockedAbcSlots, setUnlockedAbcSlots] = useState(3);
  const [savedPoses, setSavedPoses] = useState<SavedPoseEntry[]>(loadPoseLibrary);

  // React mirrors for toolbar & panels
  const [uiTick, setUiTick] = useState(0);
  const [jsonText, setJsonText] = useState('');

  const buildJsonString = useCallback(() => {
    const rt = rtRef.current;
    if (!rt || !partMgrRef.current) return '';
    solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
    const snap = capturePoseSnapshot(
      rt.nodes,
      rt.by,
      rt.root,
      rt.keys,
      partMgrRef.current.inst,
      abcRef.current,
      rt.prometheusWings,
    );
    return JSON.stringify(snap);
  }, []);

  const syncUi = useCallback(() => {
    if (!jsonEditingRef.current && !benchmarkMsgRef.current) {
      const live = buildJsonString();
      if (live) setJsonText(live);
    }
    setUiTick((t) => t + 1);
  }, [buildJsonString]);

  const persistPanels = useCallback((next: Record<PanelId, PanelLayoutState>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const updatePanels = useCallback(
    (updater: (prev: Record<PanelId, PanelLayoutState>) => Record<PanelId, PanelLayoutState>) => {
      setPanels((prev) => {
        const next = updater(prev);
        persistPanels(next);
        return next;
      });
    },
    [persistPanels],
  );

  const buildAbcGhosts = useCallback((): AbcGhostItem[] => {
    const abc = abcRef.current;
    if (!abc.ghostVisible) return [];
    const nextSlot = nextAbcSlot(abc.poses, abc.activeSlot, abc.loopMode, abcLoopDirRef.current);
    const slots = ABC_SLOTS.filter((s) => s !== abc.activeSlot && abc.poses[s]);
    if (!slots.length) return [];
    slots.sort((a, b) => (a === nextSlot ? 1 : b === nextSlot ? -1 : 0));
    return slots.map((s) => ({
      slot: s,
      pose: abc.poses[s]!,
      isPrimary: s === nextSlot || slots.length === 1,
      opacity: abc.ghostOpacity,
    }));
  }, []);

  const loopTick = useCallback(
    (ts: number) => {
      const rt = rtRef.current;
      const cv = canvasRef.current;
      if (!rt || !cv) return;
      rt.raf = 0;

      const wake = () => {
        rt.actUntil = performance.now() + 1500;
        rt.dirty = true;
        if (!rt.raf) rt.raf = requestAnimationFrame(loopTick);
      };

      const wingDiff = rt.wingTarget - rt.wingPop;
      if (Math.abs(wingDiff) > 0.002) {
        rt.wingPop += wingDiff * 0.24;
        if (Math.abs(rt.wingTarget - rt.wingPop) <= 0.002) {
          rt.wingPop = rt.wingTarget;
        }
        sortPiecesForWings(rt.pieces, rt.wingPop > 0.35);
        rt.dirty = true;
      }

      const spring = snapSpringRef.current;
      if (spring) {
        const st = Math.min(1, Math.max(0, (ts - spring.t0) / spring.dur));
        const elasticCfg = {
          ...DEFAULT_MOTION_SETTINGS,
          bounce: 0.72,
          damping: 0.45,
          stagger: 0.24,
          anticipation: 0.08,
        };
        rt.nodes.forEach((n, ni) => {
          const a = spring.fromAngles[n.id] ?? n.ang;
          const b = spring.toAngles[n.id] ?? a;
          const da = normalizeDeg(b - a);
          if (Math.abs(da) < 0.01 && st < 1) return;
          const sample = evalMotionScalar(st, 'elastic', elasticCfg, getAbcNodeLag(n.id), ni);
          const next = clampAnatomicalAngle(n, a + da * (sample.inAnticipation ? sample.antPull : sample.s), rt.constrainLimits);
          n.ang = clampRealisticShoulder(n, next, rt.by, rt.prometheusWings);
        });
        rt.dirty = true;
        rt.actUntil = Math.max(rt.actUntil, performance.now() + 450);
        if (st >= 1) {
          snapSpringRef.current = null;
        }
        syncUi();
      }

      let anim = abcAnimRef.current;
      if (anim && partMgrRef.current) {
        const abc = abcRef.current;
        const isFlow = abc.feel === 'flow';
        let elapsed = Math.max(0, ts - anim.t0);
        let t = Math.min(1, elapsed / anim.dur);

        // Pure flow: constant-interval phase-locked continuous loop with zero ease and zero pause between poses
        if (isFlow && anim.isLoop && abcPlayingRef.current && t >= 1) {
          while (t >= 1) {
            const curToSlot: AbcSlot = anim.toSlot;
            const nxt = nextAbcSlot(abc.poses, curToSlot, abc.loopMode, abcLoopDirRef.current, (d) => {
              abcLoopDirRef.current = d;
            });
            if (!nxt || !abc.poses[nxt]) break;
            const fpsPeriod = 1000 / Math.max(1, abc.fps);
            const totalF = Math.max(1, abc.snapFrames);
            const dur = Math.max(16, totalF * fpsPeriod);
            const carryT0: number = anim.t0 + anim.dur;
            const nextFromPose: AbcPoseRecord = anim.toPose;
            abc.activeSlot = nxt;
            anim = {
              fromPose: nextFromPose,
              toPose: abc.poses[nxt]!,
              toSlot: nxt,
              t0: carryT0,
              dur,
              totalF,
              fpsPeriod,
              lastIdx: -1,
              isLoop: true,
            };
            abcAnimRef.current = anim;
            elapsed = Math.max(0, ts - carryT0);
            t = Math.min(1, elapsed / dur);
          }
        }

        let skipStep = false;
        if (abc.steppedFps && !isFlow && t < 1) {
          const idx = Math.min(anim.totalF, Math.floor(elapsed / anim.fpsPeriod));
          if (idx === anim.lastIdx) {
            skipStep = true;
          } else {
            anim.lastIdx = idx;
            t = Math.min(1, idx / Math.max(1, anim.totalF));
          }
        }
        if (!skipStep) {
          applyAbcTweenPose(
            anim.fromPose,
            anim.toPose,
            t,
            abc.feel,
            abc.settings,
            rt.nodes,
            rt.root,
            partMgrRef.current.inst,
            (I) => partMgrRef.current?.rebake(I, wake),
            rt.constrainLimits,
            rt.by,
            rt.prometheusWings,
          );
          rt.dirty = true;
          rt.actUntil = Math.max(rt.actUntil, performance.now() + 450);
          syncUi();
        }
        if (t >= 1 && !(isFlow && anim.isLoop && abcPlayingRef.current)) {
          const done = anim.onDone;
          abcAnimRef.current = null;
          abc.activeSlot = anim.toSlot;
          syncUi();
          done?.();
        }
      }

      const live =
        rt.mode === 'A' &&
        rt.showBones &&
        (!!dragRef.current || !!abcAnimRef.current || !!snapSpringRef.current || rt.playing || performance.now() < rt.actUntil);
      if (live) rt.dirty = true;

      if (rt.dirty) {
        rt.dirty = false;
        const startMs = performance.now();
        try {
          partMgrRef.current?.syncLinks(rt.by, wake);
          solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
          const ctx = cv.getContext('2d', { alpha: false });
          if (ctx) {
            rendererRef.current.render({
              cv,
              ctx,
              nodes: rt.nodes,
              by: rt.by,
              pieces: rt.pieces,
              sel: rt.sel,
              hov: rt.hov,
              W: rt.W,
              H: rt.H,
              z: rt.z,
              ox: rt.ox,
              oy: rt.oy,
              dpr: rt.dpr,
              mode: rt.mode,
              showBones: rt.showBones,
              showGuides: rt.showGuides,
              constrainLimits: rt.constrainLimits,
              bondOn: rt.bondOn,
              isActiveMotion: !!dragRef.current || !!abcAnimRef.current || rt.playing,
              actUntil: rt.actUntil,
              bgColor: '#121315',
              wingPop: rt.wingPop,
              abcGhosts: buildAbcGhosts(),
            });
          }
        } catch (err) {
          setHudText(`render error: ${err instanceof Error ? err.message : String(err)}`);
        }
        const elapsed = performance.now() - startMs;
        rt.ema = rt.ema ? rt.ema * 0.9 + elapsed * 0.1 : elapsed;
        if (ts - rt.hudT > 220) {
          rt.hudT = ts;
          setHudText(
            `${rt.ema.toFixed(2)} ms/frame · ${rendererRef.current.drawn} drawn · ${rendererRef.current.culled} culled · ${rt.nodes.length} bones · idle=0 CPU`,
          );
        }
      }

      if (!!abcAnimRef.current || !!snapSpringRef.current || rt.playing || rt.dirty || live || Math.abs(rt.wingTarget - rt.wingPop) > 0.002) {
        rt.raf = requestAnimationFrame(loopTick);
      } else {
        setHudText(`${rt.ema.toFixed(2)} ms last frame · idle (0 CPU)`);
      }
    },
    [buildAbcGhosts, syncUi],
  );

  const wake = useCallback(() => {
    const rt = rtRef.current;
    if (!rt) return;
    rt.actUntil = performance.now() + 1500;
    rt.dirty = true;
    if (!rt.raf) {
      rt.raf = requestAnimationFrame(loopTick);
    }
  }, [loopTick]);

  const repaint = useCallback(() => {
    const rt = rtRef.current;
    if (!rt) return;
    rt.dirty = true;
    if (!rt.raf) {
      rt.raf = requestAnimationFrame(loopTick);
    }
  }, [loopTick]);

  const fitCanvas = useCallback(() => {
    const rt = rtRef.current;
    const cv = canvasRef.current;
    if (!rt || !cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    rt.dpr = dpr;
    cv.width = Math.max(1, cv.clientWidth * dpr);
    cv.height = Math.max(1, cv.clientHeight * dpr);
    if (!rt.userView) {
      solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
      const f = computeModelFrame(rt.by, rt.pieces, rt.W, rt.H, cv.width, cv.height, dpr, rt.wingPop);
      rt.z = f.z;
      rt.ox = f.ox;
      rt.oy = f.oy;
    }
    wake();
  }, [wake]);

  const loadRigDefinition = useCallback(
    (def: RawRigDef, withDigitsAndJoints: boolean) => {
      const graph = buildRigGraph(def, withDigitsAndJoints);
      const prev = rtRef.current;
      const rt: RigRuntime = {
        W: graph.W,
        H: graph.H,
        nodes: graph.nodes,
        by: graph.by,
        root: graph.root,
        pieces: graph.pieces,
        sel: graph.root,
        hov: null,
        z: 1,
        ox: 0,
        oy: 0,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        userView: false,
        mode: prev?.mode ?? 'A',
        showBones: prev?.showBones ?? true,
        showGuides: prev?.showGuides ?? false,
        bondOn: true,
        constrainLimits: prev?.constrainLimits ?? false,
        prometheusWings: false,
        wingPop: 0,
        wingTarget: 0,
        dirty: true,
        raf: prev?.raf ?? 0,
        actUntil: performance.now() + 1500,
        playing: false,
        loop: prev?.loop ?? true,
        fps: prev?.fps ?? 24,
        frame: 0,
        t0: 0,
        keys: [],
        ema: 0,
        hudT: 0,
      };
      rtRef.current = rt;

      graph.pieces.forEach((p) => {
        if (p.src) {
          decImage(p.src)
            .then((bm) => setPieceBitmap(p, bm as CanvasImageSource & { width: number; height: number }, wake))
            .catch((er) => setHudText(`image decode failed: ${er.message}`));
        }
      });

      if (withDigitsAndJoints && partMgrRef.current) {
        partMgrRef.current.initAll(rt.by, wake);
      }

      fitCanvas();
      syncUi();
    },
    [fitCanvas, syncUi, wake],
  );

  // Initial fetch of ClaudeBase rig & part sprite assets
  useEffect(() => {
    let cancelled = false;
    fetch('/rig-data.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ rig: RawRigDef; parts: PartsManifest }>;
      })
      .then((data) => {
        if (cancelled) return;
        rawBaseRigRef.current = data.rig;
        partMgrRef.current = new PartRigManager(data.parts);
        setLoading(false);
        loadRigDefinition(data.rig, true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load rig data');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (rtRef.current?.raf) cancelAnimationFrame(rtRef.current.raf);
    };
  }, [loadRigDefinition]);

  // Resize observer on stage
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let lw = 0;
    let lh = 0;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === lw && h === lh) return;
      lw = w;
      lh = h;
      fitCanvas();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitCanvas]);

  // Hint auto-fade after 8s
  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const targetNode = (rt: RigRuntime | null): RigNode | null => {
    if (!rt) return null;
    return rt.sel.lock && rt.sel.parent ? rt.by[rt.sel.parent] : rt.sel;
  };

  const toWorld = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const cv = canvasRef.current!;
    const rt = rtRef.current!;
    const r = cv.getBoundingClientRect();
    const d = cv.width / r.width;
    return [((e.clientX - r.left) * d - rt.ox) / rt.z, ((e.clientY - r.top) * d - rt.oy) / rt.z];
  };

  const downloadBlob = (name: string, blob: Blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 999);
  };

  const handleExportPng = useCallback(() => {
    const rt = rtRef.current;
    const cv = canvasRef.current;
    if (!rt || !cv) return;
    solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
    const ctx = cv.getContext('2d', { alpha: false });
    if (ctx) {
      rendererRef.current.render({
        cv,
        ctx,
        nodes: rt.nodes,
        by: rt.by,
        pieces: rt.pieces,
        sel: rt.sel,
        hov: null,
        W: rt.W,
        H: rt.H,
        z: rt.z,
        ox: rt.ox,
        oy: rt.oy,
        dpr: rt.dpr,
        mode: rt.mode,
        showBones: rt.showBones,
        showGuides: rt.showGuides,
        constrainLimits: rt.constrainLimits,
        bondOn: rt.bondOn,
        isActiveMotion: false,
        actUntil: 0,
        bgColor: '#121315',
        wingPop: rt.wingPop,
      });
    }
    cv.toBlob((b) => {
      if (b) downloadBlob('bitruvius-pose.png', b);
    });
  }, []);

  const copyRawJson = useCallback(async () => {
    const s = buildJsonString();
    if (!s) return;
    benchmarkMsgRef.current = false;
    setJsonText(s);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(s);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = s;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    window.clearTimeout(copyToastTimerRef.current);
    setCopyToast(ok ? 'Raw JSON copied to clipboard' : 'Raw JSON ready in box');
    copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 2200);
  }, [buildJsonString]);

  const applyJsonInput = useCallback(
    (rawStr: string) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      try {
        const parsed = JSON.parse(rawStr) as Partial<PoseSnapshot>;
        const loadedKeys = applyPoseSnapshot(parsed, rt.nodes, rt.root, mgr.inst, (I) => mgr.rebake(I, wake));
        if (loadedKeys) rt.keys = loadedKeys;
        if (parsed.abc) {
          const base = createDefaultAbcState();
          abcRef.current = {
            ...base,
            ...parsed.abc,
            poses: {
              A: parsed.abc.poses?.A ?? null,
              B: parsed.abc.poses?.B ?? null,
              C: parsed.abc.poses?.C ?? null,
              D: parsed.abc.poses?.D ?? null,
              E: parsed.abc.poses?.E ?? null,
            },
            settings: { ...base.settings, ...(parsed.abc.settings ?? {}) },
          };
          const maxFilled = getFilledAbcSlots(abcRef.current.poses).reduce(
            (mx, s) => Math.max(mx, ABC_SLOTS.indexOf(s) + 1),
            3,
          );
          setUnlockedAbcSlots((prev) => Math.min(5, Math.max(prev, maxFilled)));
        }
        if (typeof parsed.prometheusWings === 'boolean') {
          rt.prometheusWings = parsed.prometheusWings;
          rt.wingTarget = parsed.prometheusWings ? 1 : 0;
          rt.wingPop = rt.wingTarget;
          sortPiecesForWings(rt.pieces, rt.prometheusWings);
        } else {
          rt.prometheusWings = false;
          rt.wingTarget = 0;
          rt.wingPop = 0;
          sortPiecesForWings(rt.pieces, false);
        }
        if (!rt.prometheusWings) {
          rt.nodes.forEach((n) => {
            n.ang = clampRealisticShoulder(n, n.ang, rt.by, false);
          });
        }
        sidePoseRef.current = null;
        snapSpringRef.current = null;
        benchmarkMsgRef.current = false;
        jsonEditingRef.current = false;
        syncUi();
        wake();
      } catch {
        setCopyToast('Invalid JSON');
        window.clearTimeout(copyToastTimerRef.current);
        copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 2200);
      }
    },
    [syncUi, wake],
  );

  const handleExportJson = useCallback(() => {
    const s = buildJsonString();
    benchmarkMsgRef.current = false;
    setJsonText(s);
    downloadBlob('bitruvius-pose.json', new Blob([s], { type: 'application/json' }));
  }, [buildJsonString]);

  const stopAbcLoop = useCallback(() => {
    abcPlayingRef.current = false;
    setAbcPlaying(false);
    abcAnimRef.current = null;
    if (abcPlayTimerRef.current) {
      window.clearTimeout(abcPlayTimerRef.current);
      abcPlayTimerRef.current = 0;
    }
  }, []);

  const animateAbcToSlot = useCallback(
    (slot: AbcSlot, onDone?: () => void, isLoop = false) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      const target = abcRef.current.poses[slot];
      if (!rt || !mgr || !target) return;

      snapSpringRef.current = null;
      const fromPose = captureAbcPose(rt.nodes, rt.root, mgr.inst);
      const abc = abcRef.current;
      const fpsPeriod = 1000 / Math.max(1, abc.fps);
      const totalF = Math.max(1, abc.snapFrames);
      const dur = Math.max(16, totalF * fpsPeriod);

      abc.activeSlot = slot;
      abcAnimRef.current = {
        fromPose,
        toPose: target,
        toSlot: slot,
        t0: performance.now(),
        dur,
        totalF,
        fpsPeriod,
        lastIdx: -1,
        isLoop,
        onDone,
      };
      syncUi();
      wake();
    },
    [syncUi, wake],
  );

  const handleCaptureAbcSlot = useCallback(
    (slot: AbcSlot) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      stopAbcLoop();
      abcRef.current.poses[slot] = captureAbcPose(rt.nodes, rt.root, mgr.inst);
      abcRef.current.activeSlot = slot;
      const slotIdx = ABC_SLOTS.indexOf(slot);
      if (slotIdx >= 2) {
        setUnlockedAbcSlots((prev) => Math.min(5, Math.max(prev, slotIdx + 2)));
      }
      syncUi();
      wake();
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(`Captured Keyframe ${slot}`);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1600);
    },
    [stopAbcLoop, syncUi, wake],
  );

  const persistPoseLibrary = useCallback((next: SavedPoseEntry[]) => {
    try {
      localStorage.setItem(POSE_LIBRARY_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const updateSavedPoses = useCallback(
    (updater: (prev: SavedPoseEntry[]) => SavedPoseEntry[]) => {
      setSavedPoses((prev) => {
        const next = updater(prev);
        persistPoseLibrary(next);
        return next;
      });
    },
    [persistPoseLibrary],
  );

  const handleSavePoseToLibrary = useCallback(
    (rawName?: string) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      const now = Date.now();
      const pose = captureAbcPose(rt.nodes, rt.root, mgr.inst);
      const savedName = rawName?.trim() || `Pose ${savedPoses.length + 1}`;
      const entry: SavedPoseEntry = {
        id: `pose_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: savedName,
        createdAt: now,
        updatedAt: now,
        prometheusWings: rt.prometheusWings,
        pose,
      };
      updateSavedPoses((prev) => [entry, ...prev]);
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(`Saved "${savedName}" to Library`);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1800);
    },
    [savedPoses.length, updateSavedPoses],
  );

  const handleApplyLibraryPose = useCallback(
    (entry: SavedPoseEntry) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      stopAbcLoop();
      applyAbcPoseInstant(entry.pose, rt.nodes, rt.root, mgr.inst, (I) => mgr.rebake(I, wake));
      const wingsOn = !!entry.prometheusWings;
      rt.prometheusWings = wingsOn;
      rt.wingTarget = wingsOn ? 1 : 0;
      rt.wingPop = rt.wingTarget;
      sortPiecesForWings(rt.pieces, wingsOn);
      if (!wingsOn) {
        rt.nodes.forEach((n) => {
          n.ang = clampRealisticShoulder(n, n.ang, rt.by, false);
        });
      }
      sidePoseRef.current = null;
      snapSpringRef.current = null;
      syncUi();
      wake();
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(`Applied "${entry.name}"`);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1500);
    },
    [stopAbcLoop, syncUi, wake],
  );

  const handleLoadLibraryPoseToSlot = useCallback(
    (entry: SavedPoseEntry, slot: AbcSlot) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      stopAbcLoop();
      abcRef.current.poses[slot] = JSON.parse(JSON.stringify(entry.pose)) as AbcPoseRecord;
      abcRef.current.activeSlot = slot;
      const slotIdx = ABC_SLOTS.indexOf(slot);
      if (slotIdx >= 2) {
        setUnlockedAbcSlots((prev) => Math.min(5, Math.max(prev, slotIdx + 1)));
      }
      applyAbcPoseInstant(entry.pose, rt.nodes, rt.root, mgr.inst, (I) => mgr.rebake(I, wake));
      const wingsOn = !!entry.prometheusWings;
      rt.prometheusWings = wingsOn;
      rt.wingTarget = wingsOn ? 1 : 0;
      rt.wingPop = rt.wingTarget;
      sortPiecesForWings(rt.pieces, wingsOn);
      if (!wingsOn) {
        rt.nodes.forEach((n) => {
          n.ang = clampRealisticShoulder(n, n.ang, rt.by, false);
        });
      }
      sidePoseRef.current = null;
      snapSpringRef.current = null;
      syncUi();
      wake();
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(`"${entry.name}" → Keyframe ${slot}`);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1700);
    },
    [stopAbcLoop, syncUi, wake],
  );

  const handleOverwriteLibraryPose = useCallback(
    (id: string) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      const pose = captureAbcPose(rt.nodes, rt.root, mgr.inst);
      const now = Date.now();
      const target = savedPoses.find((item) => item.id === id);
      updateSavedPoses((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                updatedAt: now,
                prometheusWings: rt.prometheusWings,
                pose,
              }
            : item,
        ),
      );
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(`Updated "${target?.name ?? 'Pose'}"`);
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1600);
    },
    [savedPoses, updateSavedPoses],
  );

  const handleRenameLibraryPose = useCallback(
    (id: string, name: string) => {
      updateSavedPoses((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name, updatedAt: Date.now() } : item)),
      );
    },
    [updateSavedPoses],
  );

  const handleDeleteLibraryPose = useCallback(
    (id: string) => {
      updateSavedPoses((prev) => prev.filter((item) => item.id !== id));
    },
    [updateSavedPoses],
  );

  const handleJumpAbcSlot = useCallback(
    (slot: AbcSlot) => {
      stopAbcLoop();
      animateAbcToSlot(slot);
    },
    [animateAbcToSlot, stopAbcLoop],
  );

  const handleStepAbc = useCallback(() => {
    stopAbcLoop();
    const abc = abcRef.current;
    const nxt = nextAbcSlot(abc.poses, abc.activeSlot, abc.loopMode, abcLoopDirRef.current, (d) => {
      abcLoopDirRef.current = d;
    });
    if (nxt) animateAbcToSlot(nxt);
  }, [animateAbcToSlot, stopAbcLoop]);

  const handleToggleAbcLoop = useCallback(() => {
    const abc = abcRef.current;
    if (abcPlayingRef.current) {
      stopAbcLoop();
      syncUi();
      return;
    }
    const filled = getFilledAbcSlots(abc.poses);
    if (filled.length < 2) return;
    stopAbcLoop();
    abcPlayingRef.current = true;
    setAbcPlaying(true);

    const playNext = () => {
      if (!abcPlayingRef.current) return;
      const curAbc = abcRef.current;
      const nxt = nextAbcSlot(curAbc.poses, curAbc.activeSlot, curAbc.loopMode, abcLoopDirRef.current, (d) => {
        abcLoopDirRef.current = d;
      });
      if (!nxt) {
        stopAbcLoop();
        syncUi();
        return;
      }
      animateAbcToSlot(
        nxt,
        () => {
          if (!abcPlayingRef.current) return;
          if (abcRef.current.feel === 'flow') {
            playNext();
          } else {
            const holdMs = Math.max(25, Math.round((1000 / Math.max(1, abcRef.current.fps)) * 2));
            abcPlayTimerRef.current = window.setTimeout(playNext, holdMs);
          }
        },
        true,
      );
    };
    playNext();
  }, [animateAbcToSlot, stopAbcLoop, syncUi]);

  const handleScrubAbcCycle = useCallback(
    (progress: number) => {
      const rt = rtRef.current;
      const mgr = partMgrRef.current;
      if (!rt || !mgr) return;
      stopAbcLoop();
      const abc = abcRef.current;
      const segments = getAbcCycleSequence(abc.poses, abc.loopMode);
      if (!segments.length) return;
      const clamped = Math.max(0, Math.min(1, progress));
      abcScrubRef.current = clamped;

      const scaled = clamped * segments.length;
      const segIdx = Math.min(segments.length - 1, Math.floor(scaled));
      const localT = clamped >= 1 ? 1 : scaled - segIdx;
      const [fromSlot, toSlot] = segments[segIdx];
      const fromPose = abc.poses[fromSlot];
      const toPose = abc.poses[toSlot];
      if (!fromPose || !toPose) return;

      abc.activeSlot = localT < 0.5 ? fromSlot : toSlot;
      applyAbcTweenPose(
        fromPose,
        toPose,
        localT,
        abc.feel,
        abc.settings,
        rt.nodes,
        rt.root,
        mgr.inst,
        (I) => mgr.rebake(I, wake),
        rt.constrainLimits,
        rt.by,
        rt.prometheusWings,
      );
      syncUi();
      wake();
    },
    [stopAbcLoop, syncUi, wake],
  );

  // Keyboard shortcuts matching ClaudeBase + ABC capture/loop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePart(null);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName || '';
      if (/TEXTAREA|INPUT|SELECT/.test(tag)) return;
      const rt = rtRef.current;
      if (!rt) return;
      const tgt = targetNode(rt);
      if (!tgt) return;
      const step = e.shiftKey ? 5 : 1;

      if (e.key === 'ArrowLeft') {
        tgt.ang = clampAnatomicalAngle(
          tgt,
          clampRealisticShoulder(tgt, tgt.ang - step, rt.by, rt.prometheusWings),
          rt.constrainLimits,
        );
      } else if (e.key === 'ArrowRight') {
        tgt.ang = clampAnatomicalAngle(
          tgt,
          clampRealisticShoulder(tgt, tgt.ang + step, rt.by, rt.prometheusWings),
          rt.constrainLimits,
        );
      } else if (e.key === ' ') {
        e.preventDefault();
        handleToggleAbcLoop();
        return;
      } else if (e.key === 'k' || e.key === 'K') {
        const abc = abcRef.current;
        const nextEmpty = ABC_SLOTS.find((s) => !abc.poses[s]);
        handleCaptureAbcSlot(nextEmpty ?? abc.activeSlot);
        return;
      } else if (e.key === 'f' || e.key === 'F') {
        rt.userView = false;
        fitCanvas();
        return;
      } else {
        return;
      }
      syncUi();
      wake();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fitCanvas, handleCaptureAbcSlot, handleToggleAbcLoop, syncUi, wake]);

  const openPartForNode = useCallback((node: RigNode) => {
    const mgr = partMgrRef.current;
    if (!mgr) return;
    const I = mgr.inst[node.id] || (node.parent ? mgr.inst[node.parent] : undefined);
    if (I) {
      mgr.loadPartAssets(I.key).then(() => {
        setActivePart(I);
      });
    }
  }, []);

  const isSwivelId = (id: string) =>
    id === 'swivelL' || id === 'swivelR' || id === 'swivelTipL' || id === 'swivelTipR';

  const triggerSidePoseSnap = useCallback(
    (targetSide: 'L' | 'R' | null) => {
      const rt = rtRef.current;
      if (!rt) return;

      const fromAngles: Record<string, number> = {};
      rt.nodes.forEach((n) => {
        fromAngles[n.id] = n.ang;
      });
      const toAngles: Record<string, number> = { ...fromAngles };

      if (targetSide === null) {
        sidePoseRef.current = null;
        for (const id of [
          'pelvis',
          'hipR',
          'hipL',
          'femurR',
          'femurL',
          'shinR',
          'shinL',
          'footR',
          'footL',
          'lumbar',
          'thorax',
          'neck',
          'head',
          'swivelR',
          'swivelL',
          'acromionR',
          'acromionL',
          'braceR',
          'braceL',
          'humerusR',
          'humerusL',
          'forearmR',
          'forearmL',
          'handR',
          'handL',
        ]) {
          if (rt.by[id]) toAngles[id] = 0;
        }
        if (rt.by.hipR) rt.by.hipR.flipX = false;
        if (rt.by.hipL) rt.by.hipL.flipX = false;
        if (rt.by.femurR) rt.by.femurR.flipX = false;
        if (rt.by.femurL) rt.by.femurL.flipX = false;
      } else {
        sidePoseRef.current = targetSide;
        const dir = targetSide === 'R' ? 1 : -1; // 'R' = facing viewer's right (+X), 'L' = facing viewer's left (-X)
        if (rt.by.hipR) rt.by.hipR.flipX = targetSide === 'R';
        if (rt.by.femurR) rt.by.femurR.flipX = targetSide === 'R';
        if (rt.by.hipL) rt.by.hipL.flipX = targetSide === 'L';
        if (rt.by.femurL) rt.by.femurL.flipX = targetSide === 'L';

        // Hips + staggered side-view legs (both knees & feet oriented in profile)
        toAngles.pelvis = dir * 4;
        toAngles.hipR = targetSide === 'R' ? 8 : -6;
        toAngles.hipL = targetSide === 'R' ? -6 : 8;
        if (targetSide === 'R') {
          toAngles.femurL = -14;
          toAngles.shinL = 24;
          toAngles.footL = -8;
          toAngles.femurR = 14;
          toAngles.shinR = -6;
          toAngles.footR = 8;
        } else {
          toAngles.femurR = 14;
          toAngles.shinR = -24;
          toAngles.footR = 8;
          toAngles.femurL = -14;
          toAngles.shinL = 6;
          toAngles.footL = -8;
        }

        // Spine & head profile turn
        toAngles.lumbar = dir * -4;
        toAngles.thorax = dir * -5;
        toAngles.neck = dir * 8;
        toAngles.head = dir * 14;

        // Shoulders & arms balance in side profile
        toAngles.swivelR = dir * -10;
        toAngles.swivelL = dir * -14;
        toAngles.acromionR = dir * 10;
        toAngles.acromionL = dir * 12;
        toAngles.braceR = dir * -6;
        toAngles.braceL = dir * -6;

        if (targetSide === 'R') {
          toAngles.humerusR = -30;
          toAngles.forearmR = -28;
          toAngles.handR = -8;
          toAngles.humerusL = 18;
          toAngles.forearmL = -18;
          toAngles.handL = 6;
        } else {
          toAngles.humerusL = 30;
          toAngles.forearmL = 28;
          toAngles.handL = 8;
          toAngles.humerusR = -18;
          toAngles.forearmR = 18;
          toAngles.handR = -6;
        }
      }

      snapSpringRef.current = {
        fromAngles,
        toAngles,
        t0: performance.now(),
        dur: 430,
      };
      window.clearTimeout(copyToastTimerRef.current);
      setCopyToast(
        targetSide === null
          ? 'Snapped elastically · Front pose'
          : `Snapped elastically · Side pose (${targetSide === 'R' ? 'Right' : 'Left'})`,
      );
      copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1700);
      wake();
    },
    [wake],
  );

  const pickAtWorldPoint = (
    q: [number, number],
    rt: RigRuntime,
  ): { node: RigNode; piece: RigPiece | null } | null => {
    // 1. Primary anatomical joints (excluding swivel & separated hip sockets so sockets pick femurs cleanly)
    let best: RigNode | null = null;
    let bd = (22 * rt.dpr) / rt.z;
    for (const n of rt.nodes) {
      if (isSwivelId(n.id) || n.id === 'hipR' || n.id === 'hipL') continue;
      const p = pos(n, rt.by);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best) return { node: best, piece: null };

    // 2. Pixel hit-test on sprites (defer Shoulderswivel if too close to primary spine/shoulder joints)
    const hit = hitTestPiece(q, rt.pieces, rt.wingPop);
    if (hit) {
      if (hit.piece.name === 'Shoulderswivel') {
        const minPrimaryDist = (30 * rt.dpr) / rt.z;
        const nearPrimary = [
          'thorax',
          'lumbar',
          'pelvis',
          'acromionL',
          'acromionR',
          'braceL',
          'braceR',
          'wingL',
          'wingR',
          'humerusL',
          'humerusR',
        ].some((id) => {
          const pn = rt.by[id];
          if (!pn) return false;
          const pp = pos(pn, rt.by);
          return Math.hypot(pp[0] - q[0], pp[1] - q[1]) < minPrimaryDist;
        });
        if (!nearPrimary) {
          return { node: hit.node, piece: hit.piece };
        }
      } else {
        return { node: hit.node, piece: hit.piece };
      }
    }

    // 3. Fallback tight radius for intentional swivel dot clicks
    let swBest: RigNode | null = null;
    let swBd = (9.5 * rt.dpr) / rt.z;
    for (const n of rt.nodes) {
      if (!isSwivelId(n.id)) continue;
      const p = pos(n, rt.by);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < swBd) {
        swBd = d;
        swBest = n;
      }
    }
    if (swBest) return { node: swBest, piece: null };
    return hit ? { node: hit.node, piece: hit.piece } : null;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setHintVisible(false);
    const rt = rtRef.current;
    const cv = canvasRef.current;
    if (!rt || !cv) return;
    cv.setPointerCapture(e.pointerId);

    if (e.shiftKey || e.button === 1) {
      rt.userView = true;
      dragRef.current = { t: 'pan', x: e.clientX, y: e.clientY, ox: rt.ox, oy: rt.oy };
      return;
    }

    stopAbcLoop();
    snapSpringRef.current = null;
    solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
    const q = toWorld(e);
    const picked = pickAtWorldPoint(q, rt);
    if (picked) {
      rt.sel = picked.node;
    }
    syncUi();
    wake();

    // Separated Hip cluster (upper round swivels & chains leg + snaps >10% flip to side view)
    if (rt.sel.id === 'hipR' || rt.sel.id === 'hipL') {
      const hipSide: 'L' | 'R' = rt.sel.id === 'hipL' ? 'L' : 'R';
      const hipNode = rt.sel;
      const femur = rt.by['femur' + hipSide];
      const shin = rt.by['shin' + hipSide];
      const foot = rt.by['foot' + hipSide];
      let onUpperRound = true;
      const hp = picked?.piece ?? hipNode.pieces[0];
      if (hp) {
        const w = hipNode.w;
        const det = w[0] * w[3] - w[1] * w[2];
        if (det) {
          const dx = q[0] - w[4];
          const dy = q[1] - w[5];
          const localY = (-w[1] * dx + w[0] * dy) / det;
          onUpperRound = localY <= hp.y + hp.h * 0.68;
        }
      }
      if (onUpperRound && femur) {
        const hpPos = pos(hipNode, rt.by);
        dragRef.current = {
          t: 'hipSwivel',
          side: hipSide,
          sAng: Math.atan2(q[1] - hpPos[1], q[0] - hpPos[0]),
          hip0: hipNode.ang,
          femur0: femur.ang,
          shin0: shin?.ang ?? 0,
          foot0: foot?.ang ?? 0,
          flipped0: !!hipNode.flipX,
        };
        return;
      }
      // Lower hip base rotates pelvis rigidly
      rt.sel = rt.root;
    }

    // Coordinated piece-guided shoulder girdle (wing circle, Backshoulder, Shouldertendon, Shoulderbone)
    const selId = rt.sel.id;
    const side: 'L' | 'R' | null = selId.endsWith('L') ? 'L' : selId.endsWith('R') ? 'R' : null;
    let guide: 'wing' | 'tendon' | 'acromion' | 'prometheus' | null = null;
    if (selId === 'wingL' || selId === 'wingR' || picked?.piece?.name === 'Backshoulder') {
      guide = rt.prometheusWings ? 'prometheus' : 'wing';
    } else if (picked?.piece?.name === 'Shouldertendon') {
      guide = 'tendon';
    } else if (selId === 'braceL' || selId === 'braceR') {
      guide = rt.prometheusWings ? 'prometheus' : 'tendon';
    } else if (selId === 'acromionL' || selId === 'acromionR' || picked?.piece?.name === 'Shoulderbone') {
      guide = 'acromion';
    }

    if (guide && side) {
      const swivel = rt.by['swivel' + side];
      const acromion = rt.by['acromion' + side];
      const brace = rt.by['brace' + side];
      if (swivel && acromion && brace) {
        const swPos = pos(swivel, rt.by);
        const neckPos = pos(brace, rt.by);
        dragRef.current = {
          t: 'shoulder',
          side,
          guide,
          sSwivel: Math.atan2(q[1] - swPos[1], q[0] - swPos[0]),
          sNeck: Math.atan2(q[1] - neckPos[1], q[0] - neckPos[0]),
          swivel0: swivel.ang,
          acro0: acromion.ang,
          brace0: brace.ang,
        };
        return;
      }
    }

    // Pure FK mode: quick click-drag rotates sel (respecting mirrored leg det sign). No active IK solver.
    const pp = pos(rt.sel, rt.by);
    const par = parentOf(rt.sel, rt.by);
    const pw = par ? par.w : [1, 0, 0, 1, 0, 0];
    const parDetSign = pw[0] * pw[3] - pw[1] * pw[2] < 0 ? -1 : 1;
    dragRef.current = {
      t: 'rot',
      a0: rt.sel.ang,
      s: Math.atan2(q[1] - pp[1], q[0] - pp[0]),
      rawAng: rt.sel.ang,
      parDetSign,
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rt = rtRef.current;
    const cv = canvasRef.current;
    if (!rt || !cv) return;

    const drag = dragRef.current;
    if (!drag) {
      solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
      const q = toWorld(e);
      const picked = pickAtWorldPoint(q, rt);
      const best = picked?.node ?? null;
      if (best !== rt.hov) {
        rt.hov = best;
        cv.style.cursor = best ? 'pointer' : 'crosshair';
        repaint();
      }
      return;
    }

    if (drag.t === 'pan') {
      const d = cv.width / cv.getBoundingClientRect().width;
      rt.ox = drag.ox + (e.clientX - drag.x) * d;
      rt.oy = drag.oy + (e.clientY - drag.y) * d;
      wake();
      return;
    }

    const q = toWorld(e);

    if (drag.t === 'hipSwivel') {
      solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
      const hip = rt.by['hip' + drag.side];
      const femur = rt.by['femur' + drag.side];
      const shin = rt.by['shin' + drag.side];
      const foot = rt.by['foot' + drag.side];
      if (hip && femur) {
        const hpPos = pos(hip, rt.by);
        const curAng = Math.atan2(q[1] - hpPos[1], q[0] - hpPos[0]);
        const dAng = normalizeDeg((curAng - drag.sAng) / DEG);
        const rawTarget = drag.hip0 + dAng * 0.55;

        // Mostly rigid hip swivel [-12, 12]; >10% (15deg) in other direction snaps & flips leg to side view
        const flipThresh = 15;
        if (Math.abs(dAng) > flipThresh) {
          const nextFlip = !drag.flipped0;
          hip.flipX = nextFlip;
          femur.flipX = nextFlip;
          hip.ang = nextFlip ? (drag.side === 'R' ? 8 : -8) : 0;
          femur.ang = nextFlip ? (drag.side === 'R' ? 10 : -10) : 0;
          if (shin) shin.ang = nextFlip ? (drag.side === 'R' ? -10 : 10) : 0;
          if (foot) foot.ang = nextFlip ? (drag.side === 'R' ? 6 : -6) : 0;

          drag.sAng = curAng;
          drag.hip0 = hip.ang;
          drag.femur0 = femur.ang;
          drag.shin0 = shin?.ang ?? 0;
          drag.foot0 = foot?.ang ?? 0;
          drag.flipped0 = nextFlip;

          window.clearTimeout(copyToastTimerRef.current);
          setCopyToast(
            `${drag.side === 'R' ? 'Right' : 'Left'} hip snapped · ${nextFlip ? 'side view leg flip' : 'front view'}`,
          );
          copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1600);
        } else {
          hip.ang = Math.max(-12, Math.min(12, rawTarget));
          const deltaHip = hip.ang - drag.hip0;
          // Coordinated hip-to-leg chain reaction while swiveling
          femur.ang = clampAnatomicalAngle(femur, drag.femur0 + deltaHip * 0.65, rt.constrainLimits);
          const shinSign = femur.flipX ? -1 : 1;
          if (shin) shin.ang = clampAnatomicalAngle(shin, drag.shin0 - deltaHip * 0.4 * shinSign, rt.constrainLimits);
          if (foot) foot.ang = clampAnatomicalAngle(foot, drag.foot0 + deltaHip * 0.2 * shinSign, rt.constrainLimits);
        }
        syncUi();
        wake();
      }
      return;
    }

    if (drag.t === 'shoulder') {
      solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
      const swivel = rt.by['swivel' + drag.side];
      const acromion = rt.by['acromion' + drag.side];
      const brace = rt.by['brace' + drag.side];
      if (swivel && acromion && brace) {
        const swPos = pos(swivel, rt.by);
        const neckPos = pos(brace, rt.by);
        const dSwivel = normalizeDeg((Math.atan2(q[1] - swPos[1], q[0] - swPos[0]) - drag.sSwivel) / DEG);
        const dNeck = normalizeDeg((Math.atan2(q[1] - neckPos[1], q[0] - neckPos[0]) - drag.sNeck) / DEG);

        if (drag.guide === 'wing') {
          swivel.ang = clampAnatomicalAngle(
            swivel,
            clampRealisticShoulder(swivel, drag.swivel0 + dSwivel, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          brace.ang = clampAnatomicalAngle(
            brace,
            clampRealisticShoulder(brace, drag.brace0 + dSwivel * 0.35, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          acromion.ang = clampAnatomicalAngle(
            acromion,
            clampRealisticShoulder(acromion, drag.acro0 - dSwivel * 0.45, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
        } else if (drag.guide === 'tendon') {
          swivel.ang = clampAnatomicalAngle(
            swivel,
            clampRealisticShoulder(swivel, drag.swivel0 + dSwivel * 0.85, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          brace.ang = clampAnatomicalAngle(
            brace,
            clampRealisticShoulder(brace, drag.brace0 + dNeck * 0.55, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          acromion.ang = clampAnatomicalAngle(
            acromion,
            clampRealisticShoulder(acromion, drag.acro0 - dSwivel * 0.25, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
        } else if (drag.guide === 'acromion') {
          acromion.ang = clampAnatomicalAngle(
            acromion,
            clampRealisticShoulder(acromion, drag.acro0 + dNeck * 0.9, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          swivel.ang = clampAnatomicalAngle(
            swivel,
            clampRealisticShoulder(swivel, drag.swivel0 + dSwivel * 0.55, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
          brace.ang = clampAnatomicalAngle(
            brace,
            clampRealisticShoulder(brace, drag.brace0 + dSwivel * 0.25, rt.by, rt.prometheusWings),
            rt.constrainLimits,
          );
        } else {
          brace.ang = clampAnatomicalAngle(brace, drag.brace0 + dNeck, rt.constrainLimits);
          swivel.ang = clampAnatomicalAngle(swivel, drag.swivel0 + dSwivel * 0.25, rt.constrainLimits);
        }
        syncUi();
        wake();
      }
      return;
    }

    if (rt.sel.lock && rt.sel.parent) {
      solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
      const par = rt.by[rt.sel.parent];
      const gp = parentOf(par, rt.by);
      const gpw = gp ? gp.w : [1, 0, 0, 1, 0, 0];
      const gpDetSign = gpw[0] * gpw[3] - gpw[1] * gpw[2] < 0 ? -1 : 1;
      const a = pos(par, rt.by);
      const t = pos(rt.sel, rt.by);
      const d = (Math.atan2(q[1] - a[1], q[0] - a[0]) - Math.atan2(t[1] - a[1], t[0] - a[0])) * gpDetSign;
      par.ang = clampAnatomicalAngle(
        par,
        clampRealisticShoulder(par, par.ang + d / DEG, rt.by, rt.prometheusWings),
        rt.constrainLimits,
      );
      syncUi();
      wake();
      return;
    }

    solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
    const pp = pos(rt.sel, rt.by);
    const curAng = Math.atan2(q[1] - pp[1], q[0] - pp[0]);
    const stepDelta = normalizeDeg(((curAng - drag.s) / DEG) * drag.parDetSign);
    drag.s = curAng;
    drag.rawAng += stepDelta;
    const rawDelta = drag.rawAng - drag.a0;
    const rawIntent = normalizeDeg(drag.rawAng);

    // Arm cross-center slow-down resistance & 12.5% (45deg) elastic side-pose snap
    if (rt.sel.id === 'humerusR' || rt.sel.id === 'humerusL') {
      const isRightArm = rt.sel.id === 'humerusR';
      const inwardSign = isRightArm ? -1 : 1; // R swings inward with -ang, L swings inward with +ang
      const snapSide: 'R' | 'L' = isRightArm ? 'R' : 'L';
      const curSide = sidePoseRef.current;

      if (curSide === null) {
        const inwardDeg = rawIntent * inwardSign;
        if (inwardDeg >= 45) {
          dragRef.current = null;
          triggerSidePoseSnap(snapSide);
          syncUi();
          return;
        }
        // Progressive slow-down resistance once arm crosses inward past 14 deg
        let visualAng = rawIntent;
        if (inwardDeg > 14) {
          const excess = inwardDeg - 14;
          const slowed = 14 + 17 * Math.tanh(excess / 24);
          visualAng = inwardSign * slowed;
        }
        rt.sel.ang = clampAnatomicalAngle(rt.sel, visualAng, rt.constrainLimits);
        // Subtle elastic shoulder pre-load follow while pushing against the resistance
        const sw = rt.by['swivel' + (isRightArm ? 'R' : 'L')];
        if (sw && inwardDeg > 14) {
          const tension = Math.min(1, (inwardDeg - 14) / 31);
          sw.ang = clampRealisticShoulder(sw, inwardSign * -10 * tension, rt.by, rt.prometheusWings);
        }
        syncUi();
        wake();
        return;
      }

      // Already in a Side Pose: pulling the arm 12.5% (45deg) back in the other direction snaps back to front
      const unwindDelta = rawDelta * (curSide === 'R' ? 1 : -1);
      if (unwindDelta >= 45) {
        dragRef.current = null;
        triggerSidePoseSnap(null);
        syncUi();
        return;
      }
      let visualAng = rawIntent;
      if (unwindDelta > 14) {
        const excess = unwindDelta - 14;
        const resistStep = 14 + 17 * Math.tanh(excess / 24);
        visualAng = normalizeDeg(drag.a0 + (curSide === 'R' ? resistStep : -resistStep));
      }
      rt.sel.ang = clampAnatomicalAngle(rt.sel, visualAng, rt.constrainLimits);
      syncUi();
      wake();
      return;
    }

    rt.sel.ang = clampAnatomicalAngle(
      rt.sel,
      clampRealisticShoulder(rt.sel, rawIntent, rt.by, rt.prometheusWings),
      rt.constrainLimits,
    );
    syncUi();
    wake();
  };

  const handleCanvasPointerUp = () => {
    dragRef.current = null;
    syncUi();
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rt = rtRef.current;
    const cv = canvasRef.current;
    if (!rt || !cv) return;
    rt.userView = true;
    const r = cv.getBoundingClientRect();
    const d = cv.width / r.width;
    const mx = (e.clientX - r.left) * d;
    const my = (e.clientY - r.top) * d;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    rt.ox = mx - (mx - rt.ox) * k;
    rt.oy = my - (my - rt.oy) * k;
    rt.z *= k;
    wake();
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rt = rtRef.current;
    if (!rt) return;
    solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
    const q = toWorld(e);
    const wingHitR = (26 * rt.dpr) / rt.z;
    for (const id of ['wingL', 'wingR'] as const) {
      const wn = rt.by[id];
      if (!wn) continue;
      const wp = pos(wn, rt.by);
      if (Math.hypot(wp[0] - q[0], wp[1] - q[1]) <= wingHitR) {
        rt.prometheusWings = !rt.prometheusWings;
        rt.wingTarget = rt.prometheusWings ? 1 : 0;
        rt.sel = wn;
        sortPiecesForWings(rt.pieces, rt.prometheusWings);
        if (!rt.prometheusWings) {
          rt.nodes.forEach((n) => {
            n.ang = clampRealisticShoulder(n, n.ang, rt.by, false);
          });
        }
        window.clearTimeout(copyToastTimerRef.current);
        setCopyToast(rt.prometheusWings ? 'Prometheus wings popped out' : 'Prometheus wings tucked');
        copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1600);
        syncUi();
        wake();
        return;
      }
    }
    const hit = hitTest(q, rt.pieces, rt.wingPop);
    if (hit) openPartForNode(hit);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    rightClickRef.current.count++;
    window.clearTimeout(rightClickRef.current.timer);
    rightClickRef.current.timer = window.setTimeout(() => {
      const n = rightClickRef.current.count;
      rightClickRef.current.count = 0;
      if (n === 2) void copyRawJson();
      else if (n >= 3) handleExportPng();
    }, 420);
  };

  const togglePanel = (id: PanelId) => {
    updatePanels((prev) => {
      const wasOpen = prev[id].open;
      return {
        ...prev,
        [id]: {
          ...prev[id],
          open: !wasOpen,
          zIndex: !wasOpen ? ++zCounterRef.current : prev[id].zIndex,
        },
      };
    });
  };

  const focusPanel = (id: PanelId) => {
    updatePanels((prev) => ({
      ...prev,
      [id]: { ...prev[id], zIndex: ++zCounterRef.current },
    }));
  };

  const rt = rtRef.current;
  const tgt = targetNode(rt);
  const bondStatus: BondStatusItem[] = rt ? getBondStatus(rt.nodes, rt.bondOn) : [];
  const canEditSelectedPart = !!(
    rt &&
    partMgrRef.current &&
    (partMgrRef.current.inst[rt.sel.id] || (rt.sel.parent && partMgrRef.current.inst[rt.sel.parent]))
  );

  // Trigger re-read whenever uiTick advances
  void uiTick;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#121315] text-[#e6e8ec] select-none">
      {/* Fullscreen Stage */}
      <div ref={stageRef} className="fixed inset-0 bg-[#121315]">
        <canvas
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerLeave={() => {
            if (rtRef.current?.hov) {
              rtRef.current.hov = null;
              if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
              repaint();
            }
          }}
          onWheel={handleCanvasWheel}
          onDoubleClick={handleCanvasDoubleClick}
          onContextMenu={handleContextMenu}
          className="block h-full w-full touch-none cursor-crosshair"
        />
      </div>

      {/* Loading / Error State */}
      {loading && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#121315]/90">
          <div className="rounded-lg border border-[#2b2f36] bg-[#191b1f] px-5 py-3 text-[13px] text-[#c7cbd3]">
            Decoding Vitruvian FK rig assets…
          </div>
        </div>
      )}
      {loadError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#121315]/95">
          <div className="rounded-lg border border-[#ff3b6b] bg-[#191b1f] px-5 py-4 text-[13px] text-[#ff6b8f]">
            Failed to load rig data: {loadError}
          </div>
        </div>
      )}

      {/* Calm Compact Toolbar */}
      <TopToolbar
        panels={panels}
        mode={rt?.mode ?? 'A'}
        showBones={rt?.showBones ?? true}
        showGuides={rt?.showGuides ?? false}
        onTogglePanel={togglePanel}
        onModeChange={(m) => {
          if (!rt) return;
          rt.mode = m;
          if (m === 'D') rt.showBones = true;
          syncUi();
          wake();
        }}
        onToggleBones={(v) => {
          if (!rt) return;
          rt.showBones = v;
          syncUi();
          wake();
        }}
        onToggleGuides={(v) => {
          if (!rt) return;
          rt.showGuides = v;
          syncUi();
          wake();
        }}
        onFit={() => {
          if (!rt) return;
          rt.userView = false;
          fitCanvas();
        }}
      />

      {/* Docked / Floating Panels Container */}
      <div
        className="pointer-events-none fixed right-2 bottom-2 z-20 flex w-[300px] flex-col gap-2 overflow-y-auto max-md:top-auto max-md:left-2 max-md:w-auto max-md:max-h-[46%]"
        style={{ top: 'calc(58px + env(safe-area-inset-top, 0px))' }}
      >
        <FloatingPanel
          id="pose"
          title="Pose"
          layout={panels.pose}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <PosePanel
            selected={rt?.sel ?? null}
            target={tgt}
            isRoot={!!(rt && rt.sel === rt.root)}
            rootTx={rt?.root.tx ?? 0}
            rootTy={rt?.root.ty ?? 0}
            bondOn={rt?.bondOn ?? true}
            constrainLimits={rt?.constrainLimits ?? false}
            prometheusWings={rt?.prometheusWings ?? false}
            bondStatus={bondStatus}
            canEditPart={canEditSelectedPart}
            onOpenPartEditor={openPartForNode}
            onAngleChange={(deg) => {
              if (!rt || !tgt) return;
              tgt.ang = clampAnatomicalAngle(
                tgt,
                clampRealisticShoulder(tgt, deg, rt.by, rt.prometheusWings),
                rt.constrainLimits,
              );
              syncUi();
              wake();
            }}
            onRootOffset={(tx, ty) => {
              if (!rt) return;
              rt.root.tx = tx;
              rt.root.ty = ty;
              syncUi();
              wake();
            }}
            onToggleBond={() => {
              if (!rt) return;
              rt.bondOn = true;
              syncUi();
              wake();
            }}
            onToggleConstrainLimits={(v) => {
              if (!rt) return;
              rt.constrainLimits = v;
              if (v) {
                rt.nodes.forEach((n) => {
                  n.ang = clampAnatomicalAngle(n, n.ang, true);
                });
              }
              syncUi();
              wake();
            }}
            onTogglePrometheusWings={(v) => {
              if (!rt) return;
              rt.prometheusWings = v;
              rt.wingTarget = v ? 1 : 0;
              sortPiecesForWings(rt.pieces, v);
              if (!v) {
                rt.nodes.forEach((n) => {
                  n.ang = clampRealisticShoulder(n, n.ang, rt.by, false);
                });
              }
              syncUi();
              wake();
            }}
            onResetJoint={() => {
              if (!rt) return;
              snapSpringRef.current = null;
              rt.sel.ang = 0;
              rt.sel.flipX = false;
              if (rt.sel.id === 'hipR' && rt.by.femurR) rt.by.femurR.flipX = false;
              if (rt.sel.id === 'hipL' && rt.by.femurL) rt.by.femurL.flipX = false;
              rt.sel.piv = rt.sel.rest.slice() as [number, number];
              if (rt.sel === rt.root) {
                rt.root.tx = 0;
                rt.root.ty = 0;
              }
              syncUi();
              wake();
            }}
            onResetPose={() => {
              if (!rt || !partMgrRef.current) return;
              snapSpringRef.current = null;
              sidePoseRef.current = null;
              for (const id in partMgrRef.current.inst) {
                partMgrRef.current.inst[id].reset();
              }
              rt.nodes.forEach((n) => {
                n.ang = 0;
                n.flipX = false;
                n.piv = n.rest.slice() as [number, number];
              });
              rt.root.tx = 0;
              rt.root.ty = 0;
              syncUi();
              wake();
            }}
          />
        </FloatingPanel>

        <FloatingPanel
          id="bones"
          title="Bones"
          layout={panels.bones}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <BonesPanel
            nodes={rt?.nodes ?? []}
            selectedId={rt?.sel.id ?? null}
            onSelect={(node) => {
              if (!rt) return;
              rt.sel = node;
              syncUi();
              wake();
            }}
            onRotateNode={(node, nextDeg) => {
              if (!rt) return;
              stopAbcLoop();
              rt.sel = node;
              const tgtNode = node.lock && node.parent ? rt.by[node.parent] : node;
              tgtNode.ang = clampAnatomicalAngle(
                tgtNode,
                clampRealisticShoulder(tgtNode, nextDeg, rt.by, rt.prometheusWings),
                rt.constrainLimits,
              );
              syncUi();
              wake();
            }}
            onHover={(node) => {
              if (!rt) return;
              if (rt.hov !== node) {
                rt.hov = node;
                repaint();
              }
            }}
          />
        </FloatingPanel>

        <FloatingPanel
          id="tl"
          title="ABC Keyframes"
          layout={panels.tl}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <TimelinePanel
            abc={abcRef.current}
            playing={abcPlaying}
            scrubProgress={abcScrubRef.current}
            unlockedSlots={unlockedAbcSlots}
            savedPoses={savedPoses}
            onUnlockNextSlot={() => setUnlockedAbcSlots((prev) => Math.min(5, prev + 1))}
            onCaptureSlot={handleCaptureAbcSlot}
            onJumpSlot={handleJumpAbcSlot}
            onClearSlots={() => {
              stopAbcLoop();
              abcRef.current.poses = { A: null, B: null, C: null, D: null, E: null };
              abcRef.current.activeSlot = 'A';
              abcScrubRef.current = 0;
              setUnlockedAbcSlots(3);
              syncUi();
              wake();
            }}
            onStep={handleStepAbc}
            onToggleLoopPlay={handleToggleAbcLoop}
            onLoopModeChange={(loopMode: AbcLoopMode) => {
              abcRef.current.loopMode = loopMode;
              syncUi();
            }}
            onFeelChange={(feel: MotionFeel) => {
              abcRef.current.feel = feel;
              syncUi();
            }}
            onUpdateSettings={(patch: Partial<MotionSettings>) => {
              abcRef.current.settings = { ...abcRef.current.settings, ...patch };
              syncUi();
            }}
            onToggleGhost={(visible) => {
              abcRef.current.ghostVisible = visible;
              syncUi();
              repaint();
            }}
            onGhostOpacityChange={(opacity) => {
              abcRef.current.ghostOpacity = opacity;
              syncUi();
              repaint();
            }}
            onSnapFramesChange={(frames) => {
              abcRef.current.snapFrames = frames;
              syncUi();
            }}
            onFpsChange={(fps) => {
              abcRef.current.fps = fps;
              syncUi();
            }}
            onToggleSteppedFps={(stepped) => {
              abcRef.current.steppedFps = stepped;
              syncUi();
            }}
            onScrubCycle={handleScrubAbcCycle}
            onQuickSaveToLibrary={() => handleSavePoseToLibrary()}
            onApplyLibraryPose={handleApplyLibraryPose}
            onLoadLibraryPoseToSlot={handleLoadLibraryPoseToSlot}
            onOpenLibraryTab={() => {
              updatePanels((p) => ({
                ...p,
                library: { ...p.library, open: true, collapsed: false, zIndex: ++zCounterRef.current },
              }));
            }}
          />
        </FloatingPanel>

        <FloatingPanel
          id="library"
          title="Pose Library"
          layout={panels.library}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <PoseLibraryPanel
            savedPoses={savedPoses}
            onSavePose={handleSavePoseToLibrary}
            onApplyPose={handleApplyLibraryPose}
            onLoadToSlot={handleLoadLibraryPoseToSlot}
            onOverwritePose={handleOverwriteLibraryPose}
            onRenamePose={handleRenameLibraryPose}
            onDeletePose={handleDeleteLibraryPose}
          />
        </FloatingPanel>

        <FloatingPanel
          id="data"
          title="Data"
          layout={panels.data}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <DataPanel
            jsonText={jsonText}
            onJsonTextChange={(val) => {
              benchmarkMsgRef.current = false;
              setJsonText(val);
            }}
            onJsonFocusChange={(focused) => {
              jsonEditingRef.current = focused;
              if (!focused && !benchmarkMsgRef.current) {
                const live = buildJsonString();
                if (live) setJsonText(live);
              }
            }}
            onLoadBsk={async (file) => {
              try {
                const text = await file.text();
                const def = parseBskJson(JSON.parse(text));
                benchmarkMsgRef.current = false;
                loadRigDefinition(def, false);
              } catch (err) {
                benchmarkMsgRef.current = true;
                setJsonText(`Could not load skeleton: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            onExportBsk={() => {
              if (!rt) return;
              const data = exportBskJson(rt.nodes, rt.by, rt.W, rt.H);
              downloadBlob(
                'bitruvius.bsk.json',
                new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }),
              );
            }}
            onDemoRig={() => {
              if (rawBaseRigRef.current) {
                benchmarkMsgRef.current = false;
                loadRigDefinition(rawBaseRigRef.current, true);
              }
            }}
            onBenchmark={() => {
              if (!rt || !canvasRef.current) return;
              const cv = canvasRef.current;
              const ctx = cv.getContext('2d', { alpha: false });
              if (!ctx) return;
              const old = rt.nodes.map((n) => n.ang);
              const ts: number[] = [];
              let i = 0;
              const step = () => {
                rt.nodes.forEach((n, k) => {
                  n.ang = old[k] + Math.sin(i / 20 + k) * 12;
                });
                const s = performance.now();
                solveRig(rt.nodes, rt.by, rt.bondOn, rt.wingPop);
                rendererRef.current.render({
                  cv,
                  ctx,
                  nodes: rt.nodes,
                  by: rt.by,
                  pieces: rt.pieces,
                  sel: rt.sel,
                  hov: null,
                  W: rt.W,
                  H: rt.H,
                  z: rt.z,
                  ox: rt.ox,
                  oy: rt.oy,
                  dpr: rt.dpr,
                  mode: rt.mode,
                  showBones: rt.showBones,
                  showGuides: rt.showGuides,
                  constrainLimits: rt.constrainLimits,
                  bondOn: rt.bondOn,
                  isActiveMotion: false,
                  actUntil: 0,
                  bgColor: '#121315',
                  wingPop: rt.wingPop,
                });
                ts.push(performance.now() - s);
                if (++i < 240) {
                  requestAnimationFrame(step);
                } else {
                  rt.nodes.forEach((n, k) => {
                    n.ang = old[k];
                  });
                  ts.sort((a, b) => a - b);
                  const av = ts.reduce((a, b) => a + b) / ts.length;
                  const p95 = ts[Math.floor(ts.length * 0.95)];
                  benchmarkMsgRef.current = true;
                  setJsonText(
                    `Benchmark (240 full redraws, ${rt.pieces.length} sprites): avg ${av.toFixed(
                      2,
                    )} ms, p95 ${p95.toFixed(2)} ms → ~${Math.round(1000 / Math.max(av, 0.01))} fps CPU ceiling`,
                  );
                  wake();
                }
              };
              step();
            }}
            onGetJson={() => {
              benchmarkMsgRef.current = false;
              setJsonText(buildJsonString());
            }}
            onCopyJson={() => void copyRawJson()}
            onApplyJson={() => applyJsonInput(jsonText)}
          />
        </FloatingPanel>

        <FloatingPanel
          id="roadmap"
          title="GitHub Parity Roadmap"
          layout={panels.roadmap}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <RoadmapPanel />
        </FloatingPanel>

        <FloatingPanel
          id="about"
          title="About Bitruvius"
          layout={panels.about}
          onFocus={focusPanel}
          onToggleCollapse={(id) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], collapsed: !p[id].collapsed } }))
          }
          onClose={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], open: false } }))}
          onDragFloat={(id, x, y) =>
            updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: true, x, y } }))
          }
          onDock={(id) => updatePanels((p) => ({ ...p, [id]: { ...p[id], floating: false } }))}
        >
          <AboutPanel />
        </FloatingPanel>
      </div>

      {/* Single Compact Bottom Menu (Live Coordinates JSON + Copy/Apply + JSON/PNG Export + Stats) */}
      <div
        className="fixed left-2 z-20 flex w-[min(450px,calc(100vw-16px))] items-center gap-1 rounded-lg border border-[#2b2f36] bg-[#191b1f]/95 px-2 py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
        style={{ bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}
      >
        <input
          type="text"
          value={jsonText}
          onChange={(e) => {
            benchmarkMsgRef.current = false;
            setJsonText(e.target.value);
          }}
          onFocus={(e) => {
            jsonEditingRef.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            jsonEditingRef.current = false;
            if (!benchmarkMsgRef.current) {
              const live = buildJsonString();
              if (live) setJsonText(live);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyJsonInput(jsonText);
              e.currentTarget.blur();
            }
          }}
          spellCheck={false}
          aria-label="Live coordinates and pose JSON"
          title="Live pose and joint coordinates JSON · Paste and press Enter to apply · Double right-click canvas to copy"
          className="font-mono-tabular min-w-[80px] flex-1 rounded border border-[#2b2f36] bg-[#0e0f11] px-2 py-1 text-[11px] text-[#d6dae2] focus:border-[#a855f7] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void copyRawJson()}
          title="Copy raw JSON (or double right-click canvas)"
          className="whitespace-nowrap shrink-0 rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-1 text-[11px] font-medium text-[#e6e8ec] transition-colors hover:border-[#10b981] hover:text-[#34d399]"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => applyJsonInput(jsonText)}
          title="Apply JSON pose"
          className="whitespace-nowrap shrink-0 rounded border border-[#10b981]/50 bg-[#10b981]/15 px-1.5 py-1 text-[11px] font-medium text-[#34d399] transition-colors hover:bg-[#10b981]/25"
        >
          Apply
        </button>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-[#2b2f36]" aria-hidden="true" />
        <button
          type="button"
          onClick={handleExportJson}
          title="Download pose, keys and part rigs as .json"
          className="whitespace-nowrap shrink-0 rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-1 text-[11px] font-medium text-[#e6e8ec] transition-colors hover:border-[#a855f7] hover:text-[#d8b4fe]"
        >
          JSON
        </button>
        <button
          type="button"
          onClick={handleExportPng}
          title="Export pose as PNG (also: triple right-click)"
          className="whitespace-nowrap shrink-0 rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-1 text-[11px] font-medium text-[#e6e8ec] transition-colors hover:border-[#10b981] hover:text-[#34d399]"
        >
          PNG
        </button>
        <button
          type="button"
          onClick={() => {
            setHintVisible(false);
            setShowStats((s) => !s);
            wake();
          }}
          title="Toggle frame & CPU stats"
          className={`whitespace-nowrap shrink-0 rounded border px-1.5 py-1 text-[11px] font-medium transition-colors ${
            showStats
              ? 'border-[#a855f7] bg-[#7e22ce] text-white'
              : 'border-[#2b2f36] bg-[#121315] text-[#c7cbd3] hover:border-[#a855f7]/70 hover:text-white'
          }`}
        >
          Stats
        </button>
      </div>

      {/* On-demand HUD stats (hidden unless Stats toggled) */}
      {showStats && (
        <div
          className="font-mono-tabular pointer-events-none fixed left-2 z-20 whitespace-pre text-[11px] text-[#c7cbd3]/85"
          style={{ bottom: 'calc(52px + env(safe-area-inset-bottom, 0px))' }}
        >
          {hudText}
        </div>
      )}

      {/* Copy feedback toast */}
      {copyToast && (
        <div
          className={`pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 rounded border px-3 py-1 text-[12px] font-medium shadow-lg ${
            copyToast === 'Invalid JSON'
              ? 'border-[#ff3b6b] bg-[#191b1f] text-[#ff6b8f]'
              : 'border-[#10b981] bg-[#191b1f] text-[#34d399]'
          }`}
          style={{ bottom: 'calc(54px + env(safe-area-inset-bottom, 0px))' }}
        >
          {copyToast}
        </div>
      )}

      {/* Subtle onboarding hint */}
      <div
        className={`pointer-events-none fixed left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-full border border-[#2b2f36] bg-[#191b1f]/95 px-3.5 py-1 text-center text-[12px] text-[#c7cbd3] transition-opacity duration-1000 ${
          hintVisible ? 'opacity-90' : 'opacity-0'
        }`}
        style={{ bottom: 'calc(54px + env(safe-area-inset-bottom, 0px))' }}
      >
        Click a bone, drag to rotate · double-click head, hand or foot · double right-click copies JSON
      </div>

      {/* Hierarchical Part Rig Modal (Yorrick / Gotz / Piggy) */}
      <PartRigModal
        part={activePart}
        onClose={() => setActivePart(null)}
        onMutated={(part) => {
          const rt = rtRef.current;
          const mgr = partMgrRef.current;
          if (!rt || !mgr) return;
          part.touched = 1;
          mgr.linkOut(part, rt.by);
          mgr.rebake(part, wake);
          syncUi();
        }}
      />
    </div>
  );
}
