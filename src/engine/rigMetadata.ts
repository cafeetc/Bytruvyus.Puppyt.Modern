import type { EffectorRole, LimbChainDef } from './types';

/**
 * Anatomical soft-clamp limits (degrees) stored on every node in the base FK rig.
 * Used as optional FK limit guards & visual tension cues today, and ready for
 * Phase 1 constrain-limits + Phase 5 IK solvers without modifying node schemas.
 */
export const ANATOMICAL_LIMITS: Record<string, [number, number]> = {
  pelvis: [-180, 180],
  hipR: [-12, 12],
  hipL: [-12, 12],
  lumbar: [-48, 48],
  thorax: [-42, 42],
  neck: [-45, 45],
  head: [-65, 65],
  lip: [-35, 18],
  braceL: [-18, 18],
  braceR: [-18, 18],
  swivelL: [-42, 42],
  swivelR: [-42, 42],
  acromionL: [-45, 60],
  acromionR: [-60, 45],
  humerusL: [-175, 165],
  humerusR: [-165, 175],
  forearmL: [-155, 15],
  forearmR: [-15, 155],
  handL: [-85, 85],
  handR: [-85, 85],
  thumbL: [-75, 75],
  thumbR: [-75, 75],
  fingerL: [-95, 45],
  fingerR: [-45, 95],
  femurL: [-135, 120],
  femurR: [-120, 135],
  shinL: [-15, 150],
  shinR: [-150, 15],
  footL: [-65, 75],
  footR: [-75, 65],
};

/**
 * Canonical 2-bone and spine kinematic chains prepared for future IK,
 * Balance counterweight, and Clockwork limb track copying.
 */
export const LIMB_CHAINS: LimbChainDef[] = [
  { id: 'armL', label: 'Left Arm', swiv: 'swivelL', upper: 'humerusL', lower: 'forearmL', effector: 'handL', bendSign: -1 },
  { id: 'armR', label: 'Right Arm', swiv: 'swivelR', upper: 'humerusR', lower: 'forearmR', effector: 'handR', bendSign: 1 },
  { id: 'legL', label: 'Left Leg', upper: 'femurL', lower: 'shinL', effector: 'footL', bendSign: 1 },
  { id: 'legR', label: 'Right Leg', upper: 'femurR', lower: 'shinR', effector: 'footR', bendSign: -1 },
];

export const EFFECTOR_ROLES: Record<string, EffectorRole> = {
  handL: 'handL',
  handR: 'handR',
  footL: 'footL',
  footR: 'footR',
  head: 'head',
};

export interface RoadmapPhase {
  phase: string;
  title: string;
  status: 'active' | 'next' | 'planned';
  summary: string;
  items: string[];
}

export const GITHUB_ROADMAP: RoadmapPhase[] = [
  {
    phase: 'Base',
    title: 'ClaudeBase Pure FK & IK-Ready Hooks',
    status: 'active',
    summary: 'Calm grayscale carbon canvas, purple cutout puppet & menu accents, green digital bones, magenta-red tension cues, zero active IK.',
    items: [
      'Deterministic 2500×8742 pyxl FK solver with topological ordering & Float64 matrices',
      'Closed-chain shoulder bond (bondAng + setAim) with live strain tension readout',
      'Hierarchical Yorrick (head), Gotz (hand), and Piggy (foot) sub-rig editor',
      'IK-ready schema: anatomical limits, LIMB_CHAINS, parentOf(n), worldToLocalAngle, fitBoxParams',
    ],
  },
  {
    phase: 'Phase 1',
    title: 'Anatomical Views, Symmetry & FK Depth',
    status: 'next',
    summary: 'Add multi-angle anatomical inspection and coupled shoulder mechanics.',
    items: [
      'Back view (bv) with dorsal shoulder wing z-order flip (zBack)',
      '360° Turn Rig + Side/Side-Flip skull views with perspective sideShifts',
      'Swivel coupling modes (Mirror / Parallel / Free / Lock ribs) + Shoulder Transition Lab',
      'Interactive pivot editing (edit pivots) & hip perspective offsets',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Camera Framing, Guides & Stage Ergonomics',
    status: 'planned',
    summary: 'Expand camera presets and workspace navigation around the generalized fitBoxParams engine.',
    items: [
      'Cam Bar presets (Full / Upper / Focus) with smooth animated transitions',
      'Vertical scroll rail & Golden Ratio Auto-Focus subtle cursor tracking',
      'Perspective horizon grid overlay (perspOn) & docked/floating layout toggle',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Live Projyct.Gotz Hand & Consolidated Skull Views',
    status: 'planned',
    summary: 'Upgrade extremity sub-rigs using the ASSET_LIBRARY consolidated specs.',
    items: [
      'Live side-by-side Gotz hand pane (5F / Claw / Trident / Mickey builds)',
      'Interactive wrist wheel, coupled grip/splay/tilt, and pose code readout',
      'View-synced Back & Side consolidated Yorrick skull assets',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Multi-Mode Motion, Snap Bar & Clockwork Engine',
    status: 'planned',
    summary: 'Layer expressive timing engines atop the unified PoseSnapshot contract.',
    items: [
      'FPS cadence gate & Fluid / Elastic / Snap (Snap/Flow/Mech/Clock) modes',
      'Draggable Snap Bar (A/B/C poses, translucent onion-skin ghosts, ping-pong loop)',
      'Clockwork stage sequencer with per-bone cubic-bezier curves, anticipation & stagger',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Full Analytical & Reverse-Hierarchy IK',
    status: 'planned',
    summary: 'Activate the dormant IK-ready chains without rewriting the FK core.',
    items: [
      '2-bone analytical limb solver (solveLimbIK) with softness & bend-hint controls',
      'Reverse-hierarchy pinning (Balance + Straight IK, Pin Feet, Pin Feet+Hands, Pin Full Rig)',
      'Counterweight balance (applyBalance), ground contact gravity, and 0.26s hold-for-IK',
    ],
  },
];
