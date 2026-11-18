import React, { useMemo, useRef, useState } from 'react';
import { getTensionRatio, toPure360 } from '../engine/fkEngine';
import { ABC_SLOTS, FPS_PRESETS, getFilledAbcSlots, sampleMotionCurvePath } from '../engine/motionEngine';
import { GITHUB_ROADMAP } from '../engine/rigMetadata';
import type {
  AbcLoopMode,
  AbcSerializedState,
  AbcSlot,
  BondStatusItem,
  MotionFeel,
  MotionSettings,
  RigNode,
  SavedPoseEntry,
} from '../engine/types';

interface PosePanelProps {
  selected: RigNode | null;
  target: RigNode | null;
  isRoot: boolean;
  rootTx: number;
  rootTy: number;
  bondOn: boolean;
  constrainLimits: boolean;
  prometheusWings?: boolean;
  bondStatus: BondStatusItem[];
  onAngleChange: (deg: number) => void;
  onRootOffset: (tx: number, ty: number) => void;
  onToggleBond: (v: boolean) => void;
  onToggleConstrainLimits: (v: boolean) => void;
  onTogglePrometheusWings?: (v: boolean) => void;
  onResetJoint: () => void;
  onResetPose: () => void;
  onOpenPartEditor?: (node: RigNode) => void;
  canEditPart: boolean;
}

export const PosePanel: React.FC<PosePanelProps> = ({
  selected,
  target,
  isRoot,
  rootTx,
  rootTy,
  bondOn,
  constrainLimits,
  prometheusWings,
  bondStatus,
  onAngleChange,
  onRootOffset,
  onToggleBond,
  onToggleConstrainLimits,
  onTogglePrometheusWings,
  onResetJoint,
  onResetPose,
  onOpenPartEditor,
  canEditPart,
}) => {
  const curAngle = target ? Math.round(target.ang) : 0;
  const tension = target ? getTensionRatio(target) : { ratio: 0, nearLimit: false, atLimit: false };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <strong className="truncate text-[13px] font-semibold text-[#e6e8ec]">
          {selected ? selected.name : '–'}
        </strong>
        {canEditPart && selected && onOpenPartEditor && (
          <button
            type="button"
            onClick={() => onOpenPartEditor(selected)}
            className="whitespace-nowrap shrink-0 rounded border border-[#a855f7]/60 bg-[#a855f7]/15 px-2 py-0.5 text-[11px] font-medium text-[#d8b4fe] transition-colors hover:bg-[#a855f7]/30"
          >
            Open sub-rig
          </button>
        )}
      </div>

      {target && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#8b919c]">
          <span>FK Pure</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">
            [{target.limits[0]}°, {target.limits[1]}°]
          </span>
          {target.effectorRole && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#c084fc]">IK-ready: {target.effectorRole}</span>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={curAngle}
          onChange={(e) => onAngleChange(+e.target.value)}
          className="studio-range flex-1"
        />
        <input
          type="number"
          min={-180}
          max={180}
          value={curAngle}
          onChange={(e) => onAngleChange(+e.target.value)}
          className={`font-mono-tabular w-16 rounded border bg-[#0e0f11] px-2 py-1 text-right text-[12px] focus:outline-none ${
            tension.atLimit || tension.nearLimit
              ? 'border-[#ff3b6b] text-[#ff3b6b]'
              : 'border-[#2b2f36] text-[#e6e8ec] focus:border-[#10b981]'
          }`}
        />
      </div>

      {isRoot && (
        <div className="space-y-1.5 border-t border-[#2b2f36] pt-2">
          <div className="flex items-center gap-2 text-[11.5px] text-[#a7abb4]">
            <span className="w-4 font-mono-tabular">X</span>
            <input
              type="range"
              min={-800}
              max={800}
              value={rootTx}
              onChange={(e) => onRootOffset(+e.target.value, rootTy)}
              className="studio-range flex-1"
            />
            <span className="font-mono-tabular w-10 text-right text-[11px]">{Math.round(rootTx)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-[#a7abb4]">
            <span className="w-4 font-mono-tabular">Y</span>
            <input
              type="range"
              min={-800}
              max={800}
              value={rootTy}
              onChange={(e) => onRootOffset(rootTx, +e.target.value)}
              className="studio-range flex-1"
            />
            <span className="font-mono-tabular w-10 text-right text-[11px]">{Math.round(rootTy)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[#2b2f36] pt-2 text-[12px] text-[#c7cbd3]">
        <label
          className="flex cursor-pointer items-center gap-1.5"
          title="Clamp FK angles to anatomical soft limits (IK-ready schema)"
        >
          <input
            type="checkbox"
            checked={constrainLimits}
            onChange={(e) => onToggleConstrainLimits(e.target.checked)}
            className="accent-[#a855f7]"
          />
          <span>Soft limits</span>
        </label>
        {onTogglePrometheusWings && (
          <label
            className="flex cursor-pointer items-center gap-1.5"
            title="Or double-click a Prometheus wing circle on the shoulder blade to pop wings out; default drag adjusts shrug & shoulders"
          >
            <input
              type="checkbox"
              checked={!!prometheusWings}
              onChange={(e) => onTogglePrometheusWings(e.target.checked)}
              className="accent-[#a855f7]"
            />
            <span>Prometheus wings</span>
          </label>
        )}
      </div>

      <div className="font-mono-tabular space-y-0.5 text-[11px]">
        {bondStatus.map((b) => (
          <div key={b.side} className={b.strained ? 'text-[#ff3b6b]' : 'text-[#34d399]'}>
            {b.side}: {b.strained ? `elastic stretch · swivel ${b.delta.toFixed(1)}°` : 'shoulder bonded'}
          </div>
        ))}
        {prometheusWings && (
          <div className="text-[#c084fc]">prometheus wings · popped out (rigid)</div>
        )}
        {(tension.nearLimit || tension.atLimit) && (
          <div className="text-[#ff3b6b]">
            {tension.atLimit ? 'tension · anatomical limit reached' : 'tension · approaching joint limit'}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onResetJoint}
          className="flex-1 whitespace-nowrap rounded border border-[#ff3b6b]/45 bg-[#ff3b6b]/10 px-2.5 py-1 text-[12px] font-medium text-[#ff6b8f] transition-colors hover:border-[#ff3b6b] hover:bg-[#ff3b6b]/20"
        >
          Reset joint
        </button>
        <button
          type="button"
          onClick={onResetPose}
          className="flex-1 whitespace-nowrap rounded border border-[#ff3b6b]/45 bg-[#ff3b6b]/10 px-2.5 py-1 text-[12px] font-medium text-[#ff6b8f] transition-colors hover:border-[#ff3b6b] hover:bg-[#ff3b6b]/20"
        >
          Reset pose
        </button>
      </div>
    </div>
  );
};

interface BonesPanelProps {
  nodes: RigNode[];
  selectedId: string | null;
  onSelect: (node: RigNode) => void;
  onRotateNode: (node: RigNode, deg: number) => void;
  onHover?: (node: RigNode | null) => void;
}

export const BonesPanel: React.FC<BonesPanelProps> = ({ nodes, selectedId, onSelect, onRotateNode, onHover }) => {
  const dragRef = useRef<{
    node: RigNode;
    startX: number;
    startAng: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  const nodesById = useMemo(() => {
    const map: Record<string, RigNode> = {};
    for (const n of nodes) map[n.id] = n;
    return map;
  }, [nodes]);

  const getDriverNode = (n: RigNode): RigNode => {
    return n.lock && n.parent && nodesById[n.parent] ? nodesById[n.parent] : n;
  };

  return (
    <div
      className="max-h-[45vh] space-y-1 overflow-y-auto pr-0.5 select-none"
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="px-0.5 pb-0.5 text-[10.5px] text-[#8b919c]">
        Click to select · Click &amp; slide for pure 360° shift
      </div>
      {nodes.map((n) => {
        const active = n.id === selectedId;
        const driver = getDriverNode(n);
        const deg360 = toPure360(driver.ang);
        const tension = getTensionRatio(driver);
        const pct = (deg360 / 360) * 100;

        return (
          <button
            key={n.id}
            type="button"
            title="Click to select · Drag horizontally for continuous 360° rotation (resets cleanly at 12 o'clock; Shift for fine control)"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                node: n,
                startX: e.clientX,
                startAng: driver.ang,
                moved: false,
                pointerId: e.pointerId,
              };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d || d.pointerId !== e.pointerId || d.node.id !== n.id) return;
              const dx = e.clientX - d.startX;
              if (!d.moved && Math.abs(dx) > 3) {
                d.moved = true;
                onSelect(n);
              }
              if (d.moved) {
                const degPerPx = e.shiftKey ? 0.5 : 1.8;
                onRotateNode(n, d.startAng + dx * degPerPx);
              }
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              if (!d || d.pointerId !== e.pointerId) return;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
              const wasMoved = d.moved;
              dragRef.current = null;
              if (!wasMoved) {
                onSelect(n);
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onMouseEnter={() => onHover?.(n)}
            className={`relative flex w-full cursor-ew-resize touch-none items-center justify-between gap-2 overflow-hidden rounded border px-2 py-1 text-left text-[12px] transition-colors ${
              active
                ? 'border-[#a855f7] bg-[#7e22ce] text-white'
                : 'border-[#2b2f36]/80 bg-[#121315]/70 text-[#d0d4dc] hover:border-[#10b981]/70 hover:text-[#34d399]'
            }`}
          >
            {/* 360° radial sweep fill (cleanly resets to 0% at 12 o'clock) */}
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-0 left-0 ${
                tension.atLimit
                  ? 'bg-[#ff3b6b]/22'
                  : active
                  ? 'bg-white/14'
                  : 'bg-[#10b981]/14'
              }`}
              style={{ width: `${pct}%` }}
            />
            <span className="relative z-10 truncate">{n.name}</span>
            <span className="relative z-10 flex shrink-0 items-center gap-1.5">
              {/* Mini 12-o'clock rotational dial */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
                className="shrink-0"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  fill="none"
                  stroke={active ? 'rgba(255,255,255,0.45)' : 'rgba(139,145,156,0.45)'}
                  strokeWidth="1.1"
                />
                {/* 12 o'clock reset tick */}
                <line
                  x1="7"
                  y1="1.2"
                  x2="7"
                  y2="3"
                  stroke={active ? '#34d399' : '#a855f7'}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <g transform={`rotate(${deg360} 7 7)`}>
                  <line
                    x1="7"
                    y1="7"
                    x2="7"
                    y2="2.2"
                    stroke={tension.atLimit ? '#ff3b6b' : active ? '#ffffff' : '#34d399'}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </g>
              </svg>
              <span
                className={`font-mono-tabular w-8 text-right text-[11px] ${
                  active
                    ? 'text-white/95'
                    : tension.atLimit
                    ? 'text-[#ff3b6b]'
                    : 'text-[#8b919c]'
                }`}
              >
                {deg360}°
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

interface TimelinePanelProps {
  abc: AbcSerializedState;
  playing: boolean;
  scrubProgress: number;
  unlockedSlots: number;
  savedPoses: SavedPoseEntry[];
  onUnlockNextSlot: () => void;
  onCaptureSlot: (slot: AbcSlot) => void;
  onJumpSlot: (slot: AbcSlot) => void;
  onClearSlots: () => void;
  onStep: () => void;
  onToggleLoopPlay: () => void;
  onLoopModeChange: (mode: AbcLoopMode) => void;
  onFeelChange: (feel: MotionFeel) => void;
  onUpdateSettings: (patch: Partial<MotionSettings>) => void;
  onToggleGhost: (visible: boolean) => void;
  onGhostOpacityChange: (opacity: number) => void;
  onSnapFramesChange: (frames: number) => void;
  onFpsChange: (fps: number) => void;
  onToggleSteppedFps: (stepped: boolean) => void;
  onScrubCycle: (progress: number) => void;
  onQuickSaveToLibrary: () => void;
  onApplyLibraryPose: (entry: SavedPoseEntry) => void;
  onLoadLibraryPoseToSlot: (entry: SavedPoseEntry, slot: AbcSlot) => void;
  onOpenLibraryTab?: () => void;
}

const FEEL_OPTIONS: Array<{ id: MotionFeel; label: string; title: string }> = [
  { id: 'flow', label: 'Flow', title: 'Pure fluid pose-to-pose FK travel without easing or overshoot' },
  { id: 'snap', label: 'Snap', title: 'Tension easing & spine wind-up leading into tight pose settle' },
  { id: 'elastic', label: 'Elastic', title: 'Damped spring overshoot with hierarchical distal whip lag' },
  { id: 'mechanical', label: 'Mech', title: 'Crisp cam-driven step with detent latch & escapement micro-jitter' },
  { id: 'clockwork', label: 'Clock', title: 'Precision brass gear teeth & pawl ratchet indexing' },
];

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  abc,
  playing,
  scrubProgress,
  unlockedSlots,
  savedPoses,
  onUnlockNextSlot,
  onCaptureSlot,
  onJumpSlot,
  onClearSlots,
  onStep,
  onToggleLoopPlay,
  onLoopModeChange,
  onFeelChange,
  onUpdateSettings,
  onToggleGhost,
  onGhostOpacityChange,
  onSnapFramesChange,
  onFpsChange,
  onToggleSteppedFps,
  onScrubCycle,
  onQuickSaveToLibrary,
  onApplyLibraryPose,
  onLoadLibraryPoseToSlot,
  onOpenLibraryTab,
}) => {
  const filled = getFilledAbcSlots(abc.poses);
  const canAnimate = filled.length >= 2;
  const durMs = Math.round((Math.max(1, abc.snapFrames) * 1000) / Math.max(1, abc.fps));

  const highestFilledIdx = filled.reduce((mx, s) => Math.max(mx, ABC_SLOTS.indexOf(s)), -1);
  const activeIdx = ABC_SLOTS.indexOf(abc.activeSlot);
  const visibleCount = Math.min(5, Math.max(3, unlockedSlots, highestFilledIdx + 1, activeIdx + 1));
  const visibleSlots = ABC_SLOTS.slice(0, visibleCount);
  const nextSlotToUnlock = visibleCount < 5 ? ABC_SLOTS[visibleCount] : null;
  const loopSlots = filled.length >= 2 ? filled : visibleSlots;

  const curveGeometry = useMemo(() => {
    const W = 252;
    const H = 56;
    const padX = 8;
    const padY = 8;
    const iw = W - padX * 2;
    const ih = H - padY * 2;
    const yZero = padY + ih * 0.72;
    const yOne = padY + ih * 0.2;
    const span = yZero - yOne;
    const pts = sampleMotionCurvePath(abc.feel, abc.settings, 64);
    const d = pts
      .map((pt, i) => {
        const x = padX + pt.u * iw;
        const y = yZero - pt.y * span;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
    return { W, H, padX, iw, yZero, yOne, d };
  }, [abc.feel, abc.settings]);

  const slotColor = (s: AbcSlot) =>
    s === 'A'
      ? 'border-[#a855f7] bg-[#7e22ce] text-white'
      : s === 'B'
      ? 'border-[#10b981] bg-[#059669] text-white'
      : s === 'C'
      ? 'border-[#ff3b6b] bg-[#be123c] text-white'
      : s === 'D'
      ? 'border-[#fbbf24] bg-[#b45309] text-white'
      : 'border-[#38bdf8] bg-[#0369a1] text-white';

  const slotBadgeClass = (s: AbcSlot) =>
    s === 'A'
      ? 'border-[#a855f7]/45 text-[#c084fc] hover:border-[#a855f7] hover:bg-[#7e22ce] hover:text-white'
      : s === 'B'
      ? 'border-[#10b981]/45 text-[#34d399] hover:border-[#10b981] hover:bg-[#059669] hover:text-white'
      : s === 'C'
      ? 'border-[#ff3b6b]/45 text-[#ff6b8f] hover:border-[#ff3b6b] hover:bg-[#be123c] hover:text-white'
      : s === 'D'
      ? 'border-[#fbbf24]/45 text-[#fbbf24] hover:border-[#fbbf24] hover:bg-[#b45309] hover:text-white'
      : 'border-[#38bdf8]/45 text-[#38bdf8] hover:border-[#38bdf8] hover:bg-[#0369a1] hover:text-white';

  return (
    <div className="space-y-2 text-[11.5px]">
      {/* Keyframes Header status + Slot unlock (+D / +E) + Clear */}
      <div className="flex items-center justify-between gap-1.5">
        <span className="min-w-0 truncate font-mono-tabular text-[11px] font-medium text-[#34d399]">
          {filled.length ? `Live: ${abc.activeSlot} (${filled.join('·')})` : `Slots: ${visibleSlots.join('·')}`}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {nextSlotToUnlock && (
            <button
              type="button"
              onClick={onUnlockNextSlot}
              title={`Activate Pose Slot ${nextSlotToUnlock} (up to 5 poses)`}
              className="rounded border border-[#a855f7]/50 bg-[#a855f7]/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#d8b4fe] transition-colors hover:bg-[#a855f7]/30"
            >
              +{nextSlotToUnlock}
            </button>
          )}
          {filled.length > 0 && (
            <button
              type="button"
              onClick={onClearSlots}
              title="Clear saved poses"
              className="rounded border border-[#ff3b6b]/40 bg-[#ff3b6b]/10 px-1.5 py-0.5 text-[10.5px] text-[#ff6b8f] hover:border-[#ff3b6b]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Set Keyframe Slots (squeezes A..E into exact same row width as activated) */}
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-[11px] text-[#8b919c]">Set</span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {visibleSlots.map((s) => {
            const hasPose = !!abc.poses[s];
            const isLive = abc.activeSlot === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onCaptureSlot(s)}
                title={`Capture current live pose into Keyframe ${s}`}
                className={`min-w-0 flex-1 whitespace-nowrap rounded border px-1 py-1 text-[11px] transition-colors ${
                  isLive && hasPose
                    ? `${slotColor(s)} font-bold`
                    : hasPose
                    ? 'border-[#a855f7]/60 bg-[#121315] font-bold text-[#e6e8ec] hover:border-[#a855f7]'
                    : 'border-[#2b2f36] bg-[#121315] font-medium text-[#c7cbd3] hover:border-[#10b981] hover:text-[#34d399]'
                }`}
              >
                {s}
                {hasPose ? '●' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Jump Keyframe Slots (squeezes A..E into exact same row width as activated) */}
      <div className="flex items-center gap-1.5">
        <span className="w-9 shrink-0 text-[11px] text-[#8b919c]">Jump</span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {visibleSlots.map((s) => {
            const hasPose = !!abc.poses[s];
            const isLive = abc.activeSlot === s && hasPose;
            return (
              <button
                key={s}
                type="button"
                disabled={!hasPose}
                onClick={() => onJumpSlot(s)}
                title={`Animate to saved Pose ${s}`}
                className={`min-w-0 flex-1 whitespace-nowrap rounded border px-1 py-1 text-[11px] font-medium transition-colors ${
                  !hasPose
                    ? 'cursor-not-allowed border-[#2b2f36]/50 bg-[#0e0f11] text-[#555b66]'
                    : isLive
                    ? slotColor(s)
                    : 'border-[#2b2f36] bg-[#121315] text-[#e6e8ec] hover:border-[#10b981] hover:text-[#34d399]'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step & Loop Transport */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!canAnimate}
          onClick={onStep}
          title="Step to next pose in selected loop order"
          className={`flex-1 rounded border px-2 py-1 text-[11.5px] font-medium transition-colors ${
            canAnimate
              ? 'border-[#10b981]/50 bg-[#10b981]/15 text-[#34d399] hover:bg-[#10b981]/25'
              : 'cursor-not-allowed border-[#2b2f36]/50 bg-[#0e0f11] text-[#555b66]'
          }`}
        >
          Step ▸
        </button>
        <button
          type="button"
          disabled={!canAnimate}
          onClick={onToggleLoopPlay}
          title="Auto-play Ping-Pong or Cycle loop"
          className={`flex-1 rounded border px-2 py-1 text-[11.5px] font-medium transition-colors ${
            !canAnimate
              ? 'cursor-not-allowed border-[#2b2f36]/50 bg-[#0e0f11] text-[#555b66]'
              : playing
              ? 'border-[#ff3b6b] bg-[#ff3b6b]/20 text-[#ff6b8f]'
              : 'border-[#a855f7]/60 bg-[#a855f7]/15 text-[#d8b4fe] hover:bg-[#a855f7]/25'
          }`}
        >
          {playing ? 'Pause ❚❚' : 'Loop ⟳'}
        </button>
      </div>

      {/* Loop Rule + Cycle Scrubber */}
      <div className="space-y-1.5">
        <select
          value={abc.loopMode}
          onChange={(e) => onLoopModeChange(e.target.value as AbcLoopMode)}
          title="Loop order across 2-5 saved poses"
          className="w-full rounded border border-[#2b2f36] bg-[#0e0f11] px-2 py-1 text-[11.5px] text-[#e6e8ec] focus:border-[#a855f7] focus:outline-none"
        >
          <option value="pingpong">Ping-Pong ({loopSlots.join(' ↔ ')})</option>
          <option value="cycle">Cycle ({loopSlots.join(' → ')} → {loopSlots[0]})</option>
        </select>

        {canAnimate && (
          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-[10.5px] text-[#8b919c]">Scrub</span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(scrubProgress * 1000)}
              onChange={(e) => onScrubCycle(+e.target.value / 1000)}
              className="studio-range flex-1"
            />
            <span className="font-mono-tabular w-9 text-right text-[10.5px] text-[#34d399]">
              {Math.round(scrubProgress * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Motion Feel Selector (Flow / Snap / Elastic / Mech / Clock) */}
      <div className="border-t border-[#2b2f36] pt-2">
        <div className="mb-1.5 flex items-center gap-1">
          {FEEL_OPTIONS.map((opt) => {
            const active = abc.feel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                title={opt.title}
                onClick={() => onFeelChange(opt.id)}
                className={`flex-1 rounded border px-1 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-[#10b981] bg-[#10b981]/20 text-[#34d399]'
                    : 'border-[#2b2f36] bg-[#121315] text-[#c7cbd3] hover:border-[#a855f7]/60 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Live Curve Preview SVG */}
        <div className="mb-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] p-1">
          <svg
            viewBox={`0 0 ${curveGeometry.W} ${curveGeometry.H}`}
            className="block h-12 w-full"
            aria-label="Motion feel response curve"
          >
            <line
              x1={curveGeometry.padX}
              y1={curveGeometry.yZero}
              x2={curveGeometry.padX + curveGeometry.iw}
              y2={curveGeometry.yZero}
              stroke="rgba(139, 145, 156, 0.28)"
              strokeWidth="1"
            />
            <line
              x1={curveGeometry.padX}
              y1={curveGeometry.yOne}
              x2={curveGeometry.padX + curveGeometry.iw}
              y2={curveGeometry.yOne}
              stroke="rgba(168, 85, 247, 0.35)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <path
              d={curveGeometry.d}
              fill="none"
              stroke={abc.feel === 'elastic' ? '#ff3b6b' : abc.feel === 'clockwork' ? '#c084fc' : '#22c55e'}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Contextual Strengthened Settings */}
        {abc.feel === 'flow' && (
          <div className="text-[11px] text-[#8b919c]">
            Pure un-eased linear motion hitting every pose on an exact interval.
          </div>
        )}

        {abc.feel === 'snap' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Tension</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(abc.settings.easing * 100)}
                onChange={(e) => onUpdateSettings({ easing: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#34d399]">
                {Math.round(abc.settings.easing * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Wind-up</span>
              <input
                type="range"
                min={0}
                max={35}
                value={Math.round(abc.settings.anticipation * 100)}
                onChange={(e) => onUpdateSettings({ anticipation: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.anticipation * 100)}%
              </span>
            </div>
          </div>
        )}

        {abc.feel === 'elastic' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Bounce</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(abc.settings.bounce * 100)}
                onChange={(e) => onUpdateSettings({ bounce: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#ff6b8f]">
                {Math.round(abc.settings.bounce * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Settle</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(abc.settings.damping * 100)}
                onChange={(e) => onUpdateSettings({ damping: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#34d399]">
                {Math.round(abc.settings.damping * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Whip Lag</span>
              <input
                type="range"
                min={0}
                max={45}
                value={Math.round(abc.settings.stagger * 100)}
                onChange={(e) => onUpdateSettings({ stagger: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.stagger * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Coil</span>
              <input
                type="range"
                min={0}
                max={35}
                value={Math.round(abc.settings.anticipation * 100)}
                onChange={(e) => onUpdateSettings({ anticipation: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.anticipation * 100)}%
              </span>
            </div>
          </div>
        )}

        {abc.feel === 'mechanical' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Torque</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(abc.settings.torque * 100)}
                onChange={(e) => onUpdateSettings({ torque: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#34d399]">
                {Math.round(abc.settings.torque * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Cam Lag</span>
              <input
                type="range"
                min={0}
                max={45}
                value={Math.round(abc.settings.stagger * 100)}
                onChange={(e) => onUpdateSettings({ stagger: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.stagger * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Wind-up</span>
              <input
                type="range"
                min={0}
                max={35}
                value={Math.round(abc.settings.anticipation * 100)}
                onChange={(e) => onUpdateSettings({ anticipation: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.anticipation * 100)}%
              </span>
            </div>
          </div>
        )}

        {abc.feel === 'clockwork' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Gear Teeth</span>
              <input
                type="range"
                min={3}
                max={16}
                step={1}
                value={abc.settings.teeth}
                onChange={(e) => onUpdateSettings({ teeth: +e.target.value })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {abc.settings.teeth}T
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Pawl Snap</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(abc.settings.pawlSnap * 100)}
                onChange={(e) => onUpdateSettings({ pawlSnap: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#34d399]">
                {Math.round(abc.settings.pawlSnap * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Gear Lag</span>
              <input
                type="range"
                min={0}
                max={45}
                value={Math.round(abc.settings.stagger * 100)}
                onChange={(e) => onUpdateSettings({ stagger: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.stagger * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10.5px] text-[#a7abb4]">Wind-up</span>
              <input
                type="range"
                min={0}
                max={35}
                value={Math.round(abc.settings.anticipation * 100)}
                onChange={(e) => onUpdateSettings({ anticipation: +e.target.value / 100 })}
                className="studio-range flex-1"
              />
              <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#c084fc]">
                {Math.round(abc.settings.anticipation * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Onion-Skin Ghost + Cadence */}
      <div className="space-y-1.5 border-t border-[#2b2f36] pt-2">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[#c7cbd3]">
            <input
              type="checkbox"
              checked={abc.ghostVisible}
              onChange={(e) => onToggleGhost(e.target.checked)}
              className="accent-[#a855f7]"
            />
            <span>Ghost</span>
          </label>
          <input
            type="range"
            min={10}
            max={70}
            value={Math.round(abc.ghostOpacity * 100)}
            onChange={(e) => onGhostOpacityChange(+e.target.value / 100)}
            title="Onion-skin ghost opacity"
            className="studio-range flex-1"
          />
          <span className="font-mono-tabular w-8 text-right text-[10.5px] text-[#8b919c]">
            {Math.round(abc.ghostOpacity * 100)}%
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#c7cbd3]">
          <label className="flex items-center gap-1">
            <span>Frames</span>
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              value={abc.snapFrames}
              onChange={(e) => onSnapFramesChange(Math.max(1, Math.min(120, Math.round(+e.target.value || 1))))}
              className="font-mono-tabular w-12 rounded border border-[#2b2f36] bg-[#0e0f11] px-1.5 py-0.5 text-right text-[11px] text-[#e6e8ec]"
            />
          </label>

          <select
            value={abc.fps}
            onChange={(e) => onFpsChange(+e.target.value)}
            title="Animation cadence FPS"
            className="font-mono-tabular rounded border border-[#2b2f36] bg-[#0e0f11] px-1.5 py-0.5 text-[11px] text-[#e6e8ec]"
          >
            {FPS_PRESETS.map((f) => (
              <option key={f} value={f}>
                {f} FPS
              </option>
            ))}
          </select>

          <label className="ml-auto flex cursor-pointer items-center gap-1 text-[10.5px] text-[#a7abb4]" title="Quantize motion playback to exact FPS steps">
            <input
              type="checkbox"
              checked={abc.steppedFps}
              onChange={(e) => onToggleSteppedFps(e.target.checked)}
              className="accent-[#10b981]"
            />
            <span>stepped</span>
          </label>
        </div>

        <div className="font-mono-tabular text-[10.5px] text-[#8b919c]">
          {abc.snapFrames} frames @ {abc.fps} FPS · {durMs}ms/pose
        </div>
      </div>

      {/* Bottom Pose Library Shelf inside ABC Keyframes */}
      <div className="space-y-1.5 border-t border-[#2b2f36] pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-[#e6e8ec]">
            Pose Library <span className="font-mono-tabular font-normal text-[#8b919c]">({savedPoses.length})</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onQuickSaveToLibrary}
              title="Save current live pose into the Pose Library"
              className="whitespace-nowrap rounded border border-[#a855f7]/60 bg-[#a855f7]/15 px-1.5 py-0.5 text-[10.5px] font-medium text-[#d8b4fe] transition-colors hover:bg-[#a855f7]/30"
            >
              + Save Pose
            </button>
            {onOpenLibraryTab && (
              <button
                type="button"
                onClick={onOpenLibraryTab}
                title="Open Pose Library tab to manage or rename poses"
                className="whitespace-nowrap rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-0.5 text-[10.5px] text-[#a7abb4] transition-colors hover:border-[#10b981] hover:text-[#34d399]"
              >
                Manage
              </button>
            )}
          </div>
        </div>

        {savedPoses.length === 0 ? (
          <div className="rounded border border-[#2b2f36]/80 bg-[#0e0f11] px-2 py-1.5 text-[10.5px] text-[#8b919c]">
            No library poses yet. Save a pose above or in Pose Library to load into A–E.
          </div>
        ) : (
          <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
            {savedPoses.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-1.5 rounded border border-[#2b2f36]/80 bg-[#0e0f11] px-1.5 py-1 transition-colors hover:border-[#a855f7]/50"
              >
                <button
                  type="button"
                  onClick={() => onApplyLibraryPose(entry)}
                  title={`Apply "${entry.name}" to the live puppet`}
                  className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-[#e6e8ec] hover:text-[#34d399]"
                >
                  {entry.name}
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  {visibleSlots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onLoadLibraryPoseToSlot(entry, s)}
                      title={`Load "${entry.name}" into Keyframe ${s}`}
                      className={`rounded border px-1 py-0.5 text-[9.5px] font-semibold transition-colors ${slotBadgeClass(s)}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface PoseLibraryPanelProps {
  savedPoses: SavedPoseEntry[];
  onSavePose: (name: string) => void;
  onApplyPose: (entry: SavedPoseEntry) => void;
  onLoadToSlot: (entry: SavedPoseEntry, slot: AbcSlot) => void;
  onOverwritePose: (id: string) => void;
  onRenamePose: (id: string, name: string) => void;
  onDeletePose: (id: string) => void;
}

function countNonZeroJoints(entry: SavedPoseEntry): number {
  let count = 0;
  for (const k in entry.pose.nodes) {
    if (Math.abs(entry.pose.nodes[k]) >= 0.5) count++;
  }
  return count;
}

export const PoseLibraryPanel: React.FC<PoseLibraryPanelProps> = ({
  savedPoses,
  onSavePose,
  onApplyPose,
  onLoadToSlot,
  onOverwritePose,
  onRenamePose,
  onDeletePose,
}) => {
  const [nameInput, setNameInput] = useState('');
  const [filterText, setFilterText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = nameInput.trim();
    onSavePose(trimmed);
    setNameInput('');
  };

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return savedPoses;
    return savedPoses.filter((p) => p.name.toLowerCase().includes(q));
  }, [filterText, savedPoses]);

  const commitRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed) onRenamePose(id, trimmed);
    setEditingId(null);
  };

  return (
    <div className="space-y-2.5 text-[12px]">
      <form onSubmit={handleSave} className="flex items-center gap-1.5">
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder={`Pose ${savedPoses.length + 1} (name...)`}
          aria-label="New pose name"
          className="min-w-0 flex-1 rounded border border-[#2b2f36] bg-[#0e0f11] px-2 py-1 text-[11.5px] text-[#e6e8ec] placeholder-[#6b7280] focus:border-[#a855f7] focus:outline-none"
        />
        <button
          type="submit"
          className="whitespace-nowrap shrink-0 rounded border border-[#a855f7] bg-[#7e22ce] px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-[#9333ea]"
        >
          Save Pose
        </button>
      </form>

      {savedPoses.length > 4 && (
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter saved poses..."
          aria-label="Filter saved poses"
          className="w-full rounded border border-[#2b2f36] bg-[#0e0f11] px-2 py-1 text-[11px] text-[#d6dae2] placeholder-[#6b7280] focus:border-[#10b981] focus:outline-none"
        />
      )}

      {savedPoses.length === 0 ? (
        <div className="rounded border border-[#2b2f36] bg-[#0e0f11] p-2.5 text-[11.5px] text-[#8b919c]">
          Save your current pose above to store it in the app. Saved poses are automatically available inside{' '}
          <span className="text-[#34d399]">Keyframes</span> to load into A–E.
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-3 text-center text-[11.5px] text-[#8b919c]">No poses match &ldquo;{filterText}&rdquo;</div>
      ) : (
        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
          {filtered.map((entry) => {
            const activeJoints = countNonZeroJoints(entry);
            const isEditing = editingId === entry.id;
            const timeLabel = new Date(entry.updatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={entry.id}
                className="space-y-1.5 rounded border border-[#2b2f36] bg-[#0e0f11] p-2 transition-colors hover:border-[#a855f7]/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => commitRename(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(entry.id);
                          else if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="w-full rounded border border-[#a855f7] bg-[#121315] px-1.5 py-0.5 text-[12px] text-[#e6e8ec] focus:outline-none"
                      />
                    ) : (
                      <div
                        onDoubleClick={() => {
                          setEditingId(entry.id);
                          setEditingName(entry.name);
                        }}
                        title="Double-click to rename"
                        className="truncate text-[12px] font-semibold text-[#e6e8ec]"
                      >
                        {entry.name}
                      </div>
                    )}
                    <div className="font-mono-tabular flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#8b919c]">
                      <span>{activeJoints} posed</span>
                      {entry.prometheusWings && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#c084fc]">wings</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{timeLabel}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditingName(entry.name);
                      }}
                      title="Rename pose"
                      className="rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-0.5 text-[10.5px] text-[#a7abb4] hover:border-[#a855f7] hover:text-white"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeletePose(entry.id)}
                      title="Delete saved pose"
                      className="rounded border border-[#2b2f36] bg-[#121315] px-1.5 py-0.5 text-[10.5px] text-[#a7abb4] hover:border-[#ff3b6b] hover:text-[#ff6b8f]"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApplyPose(entry)}
                    title="Apply this pose directly to the stage puppet"
                    className="flex-1 rounded border border-[#10b981]/50 bg-[#10b981]/15 px-2 py-1 text-[11px] font-medium text-[#34d399] transition-colors hover:bg-[#10b981]/25"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => onOverwritePose(entry.id)}
                    title="Update this saved pose with the current live puppet pose"
                    className="rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11px] text-[#c7cbd3] transition-colors hover:border-[#a855f7] hover:text-white"
                  >
                    Update
                  </button>
                  <span className="mx-0.5 h-3.5 w-px bg-[#2b2f36]" aria-hidden="true" />
                  {ABC_SLOTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onLoadToSlot(entry, s)}
                      title={`Load "${entry.name}" into Keyframe ${s}`}
                      className={`rounded border bg-[#121315] px-1.5 py-1 text-[10.5px] font-semibold transition-colors ${
                        s === 'A'
                          ? 'border-[#a855f7]/50 text-[#c084fc] hover:border-[#a855f7] hover:bg-[#7e22ce] hover:text-white'
                          : s === 'B'
                          ? 'border-[#10b981]/50 text-[#34d399] hover:border-[#10b981] hover:bg-[#059669] hover:text-white'
                          : s === 'C'
                          ? 'border-[#ff3b6b]/50 text-[#ff6b8f] hover:border-[#ff3b6b] hover:bg-[#be123c] hover:text-white'
                          : s === 'D'
                          ? 'border-[#fbbf24]/50 text-[#fbbf24] hover:border-[#fbbf24] hover:bg-[#b45309] hover:text-white'
                          : 'border-[#38bdf8]/50 text-[#38bdf8] hover:border-[#38bdf8] hover:bg-[#0369a1] hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface DataPanelProps {
  jsonText: string;
  onJsonTextChange: (val: string) => void;
  onJsonFocusChange?: (focused: boolean) => void;
  onLoadBsk: (file: File) => void;
  onExportBsk: () => void;
  onDemoRig: () => void;
  onBenchmark: () => void;
  onGetJson: () => void;
  onCopyJson: () => void;
  onApplyJson: () => void;
}

export const DataPanel: React.FC<DataPanelProps> = ({
  jsonText,
  onJsonTextChange,
  onJsonFocusChange,
  onLoadBsk,
  onExportBsk,
  onDemoRig,
  onBenchmark,
  onGetJson,
  onCopyJson,
  onApplyJson,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#a855f7]"
        >
          Load .bsk.json
        </button>
        <button
          type="button"
          onClick={onExportBsk}
          className="rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#a855f7]"
        >
          Export .bsk.json
        </button>
        <button
          type="button"
          onClick={onDemoRig}
          className="rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#10b981]"
        >
          Demo rig
        </button>
        <button
          type="button"
          onClick={onBenchmark}
          className="rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#10b981]"
        >
          Benchmark
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadBsk(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onGetJson}
          className="flex-1 rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#a855f7]"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={onCopyJson}
          className="flex-1 rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[11.5px] text-[#e6e8ec] hover:border-[#10b981] hover:text-[#34d399]"
        >
          Copy JSON
        </button>
        <button
          type="button"
          onClick={onApplyJson}
          className="flex-1 rounded border border-[#10b981]/50 bg-[#10b981]/15 px-2 py-1 text-[11.5px] font-medium text-[#34d399] hover:bg-[#10b981]/25"
        >
          Apply JSON
        </button>
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => onJsonTextChange(e.target.value)}
        onFocus={() => onJsonFocusChange?.(true)}
        onBlur={() => onJsonFocusChange?.(false)}
        spellCheck={false}
        placeholder="Live pose, coordinates & keyframe JSON..."
        className="font-mono-tabular h-24 w-full rounded border border-[#2b2f36] bg-[#0e0f11] p-2 text-[11px] text-[#d6dae2] focus:border-[#a855f7] focus:outline-none"
      />
    </div>
  );
};

export const RoadmapPanel: React.FC = () => {
  return (
    <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1 text-[12px]">
      <p className="text-[#a7abb4]">
        Incremental path from this pure <strong className="text-[#e6e8ec]">ClaudeBase FK</strong> studio to full{' '}
        <span className="text-[#c084fc]">Projyct.Bytruvyus</span> GitHub parity.
      </p>
      {GITHUB_ROADMAP.map((step) => (
        <div key={step.phase} className="space-y-1 border-t border-[#2b2f36] pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[#e6e8ec]">
              {step.phase} · {step.title}
            </span>
            <span
              className={`font-mono-tabular shrink-0 text-[10.5px] ${
                step.status === 'active'
                  ? 'text-[#34d399]'
                  : step.status === 'next'
                  ? 'text-[#c084fc]'
                  : 'text-[#8b919c]'
              }`}
            >
              {step.status === 'active' ? 'ACTIVE' : step.status === 'next' ? 'NEXT' : 'PLANNED'}
            </span>
          </div>
          <p className="text-[11.5px] text-[#8b919c]">{step.summary}</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-[#c7cbd3]">
            {step.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export const AboutPanel: React.FC = () => {
  return (
    <div className="max-h-[58vh] space-y-2.5 overflow-y-auto pr-1 text-[12px] text-[#c7cbd3]">
      <p className="italic text-[#a7abb4]">
        “This is Bitruvius. He was born here, raised here. Some would argue that he’s trapped here, but that’s up to
        you. Bitruvius is a puppet. An actor. A character. You can click on any bone you see and replace it with your
        own asset. He lives in a 2D world, but sometimes there seems to be more than one dimension at play.”
      </p>

      <details open className="space-y-1">
        <summary className="cursor-pointer font-semibold text-[#e6e8ec]">The paper puppet</summary>
        <p>
          Bitruvius Puppyt is a paper puppet (papyr puppyt) powered by computational precision, for creators working
          between 2D and 3D, in the tradition of Lotte Reiniger and hinged silhouette animation.
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>An immediate anatomical building block for ink-to-paper reference</li>
          <li>An easily swappable visual asset for digital cutout animators</li>
        </ul>
      </details>

      <details className="space-y-1">
        <summary className="cursor-pointer font-semibold text-[#e6e8ec]">A computer, not a creator</summary>
        <p>
          Pure deterministic vectors, exact affine mathematics, code parsing, and spatial transformations in a basic,
          open, and replicable way—no generative noise.
        </p>
      </details>

      <details open className="space-y-1">
        <summary className="cursor-pointer font-semibold text-[#e6e8ec]">Principles & Controls</summary>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            <strong className="text-[#e6e8ec]">Pure FK + IK-ready.</strong> Direct rotational FK with closed-chain
            shoulder bonding; anatomical bounds and limb chains pre-wired for Phase 5 IK.
          </li>
          <li>
            <strong className="text-[#e6e8ec]">Deterministic stage math.</strong> 2,500 × 8,742 pyxl canvas, centerline{' '}
            <span className="font-mono-tabular text-[#c084fc]">MX = 1,257</span>, head ruler{' '}
            <span className="font-mono-tabular text-[#c084fc]">1H = 1,240</span>.
          </li>
          <li>
            <strong className="text-[#e6e8ec]">Controls.</strong> Click &amp; drag any bone or joint to rotate; drag
            shoulder blades, bones, or wing circles to adjust shrug &amp; shoulders together; double-click the Prometheus
            wing circle to pop wings out. Double-click head, hand, or foot to open its sub-rig. Shift-drag pans, wheel
            zooms, <kbd className="text-[#34d399]">F</kbd> fits, <kbd className="text-[#34d399]">Space</kbd> plays,{' '}
            <kbd className="text-[#34d399]">K</kbd> keys a pose. Double right-click auto-copies raw JSON, triple
            right-click saves PNG.
          </li>
        </ul>
      </details>
    </div>
  );
};
