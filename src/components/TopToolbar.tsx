import React from 'react';
import type { PanelId, RenderMode } from '../engine/types';
import type { PanelLayoutState } from './FloatingPanel';

interface TopToolbarProps {
  panels: Record<PanelId, PanelLayoutState>;
  mode: RenderMode;
  showBones: boolean;
  showGuides: boolean;
  onTogglePanel: (id: PanelId) => void;
  onModeChange: (mode: RenderMode) => void;
  onToggleBones: (v: boolean) => void;
  onToggleGuides: (v: boolean) => void;
  onFit: () => void;
}

const PANEL_TABS: Array<{ id: PanelId; label: string }> = [
  { id: 'pose', label: 'Pose' },
  { id: 'bones', label: 'Bones' },
  { id: 'tl', label: 'Keyframes' },
  { id: 'library', label: 'Pose Library' },
  { id: 'data', label: 'Data' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'about', label: 'About' },
];

export const TopToolbar: React.FC<TopToolbarProps> = ({
  panels,
  mode,
  showBones,
  showGuides,
  onTogglePanel,
  onModeChange,
  onToggleBones,
  onToggleGuides,
  onFit,
}) => {
  return (
    <header
      className="fixed top-2 left-2 z-30 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1.5 rounded-lg border border-[#2b2f36] bg-[#191b1f]/95 px-2.5 py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{ top: 'calc(8px + env(safe-area-inset-top, 0px))' }}
    >
      <span className="mr-1.5 whitespace-nowrap shrink-0 text-[13px] font-bold tracking-tight text-[#e6e8ec]">
        Bitruvius Puppyt
      </span>

      <div className="flex flex-wrap items-center gap-1">
        {PANEL_TABS.map((tab) => {
          const active = panels[tab.id].open;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTogglePanel(tab.id)}
              className={`whitespace-nowrap shrink-0 rounded border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'border-[#a855f7] bg-[#7e22ce] text-white'
                  : 'border-[#2b2f36] bg-[#121315] text-[#c7cbd3] hover:border-[#a855f7]/70 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <span className="mx-0.5 h-4 w-px bg-[#2b2f36]" aria-hidden="true" />

      <select
        value={mode}
        onChange={(e) => onModeChange(e.target.value as RenderMode)}
        title="Analog: the purple paper puppet. Digital: the green bones behind it."
        className="whitespace-nowrap shrink-0 rounded border border-[#2b2f36] bg-[#121315] px-2 py-1 text-[12px] text-[#e6e8ec] focus:border-[#a855f7] focus:outline-none"
      >
        <option value="A">Analog</option>
        <option value="D">Digital</option>
      </select>

      <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded px-1.5 py-1 text-[12px] text-[#c7cbd3] hover:text-white">
        <input
          type="checkbox"
          checked={showBones}
          onChange={(e) => onToggleBones(e.target.checked)}
          className="accent-[#10b981]"
        />
        <span>digital bones</span>
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0 rounded px-1.5 py-1 text-[12px] text-[#c7cbd3] hover:text-white">
        <input
          type="checkbox"
          checked={showGuides}
          onChange={(e) => onToggleGuides(e.target.checked)}
          className="accent-[#a855f7]"
        />
        <span>stage math</span>
      </label>

      <span className="mx-0.5 h-4 w-px bg-[#2b2f36]" aria-hidden="true" />

      <button
        type="button"
        onClick={onFit}
        title="Frame the whole figure (F)"
        className="whitespace-nowrap shrink-0 rounded border border-[#10b981]/50 bg-[#10b981]/15 px-2.5 py-1 text-[12px] font-medium text-[#34d399] transition-colors hover:border-[#10b981] hover:bg-[#10b981]/25"
      >
        Fit
      </button>
    </header>
  );
};
