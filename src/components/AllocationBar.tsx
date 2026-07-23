import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetAllocation } from '../types/simulation';

// Single-bar, two-dot asset allocation input (UI_REFINEMENTS.md item 1).
// The bar is always 100% by construction — dragging a dot resizes its two
// adjacent segments and cannot cross the other dot, so an invalid allocation
// (percentages not summing to 100, or a negative segment) is impossible to
// enter. Purely an input widget: still writes cashPct/bondsPct/equitiesPct.
interface AllocationBarProps {
  value: AssetAllocation;
  onChange: (allocation: AssetAllocation) => void;
  disabled?: boolean;
}

const SEGMENT_COLOR = {
  cash: 'bg-emerald-400',
  bonds: 'bg-blue-500',
  equities: 'bg-amber-500',
} as const;

export default function AllocationBar({ value, onChange, disabled = false }: AllocationBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);

  const { cashPct, bondsPct, equitiesPct } = value;
  const dot1 = cashPct; // boundary between cash and bonds
  const dot2 = cashPct + bondsPct; // boundary between bonds and equities

  const pctFromClientX = useCallback((clientX: number): number => {
    const rect = barRef.current!.getBoundingClientRect();
    const raw = ((clientX - rect.left) / rect.width) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, []);

  // Dots stop at each other: dot1 is clamped to [0, dot2], dot2 to [dot1, 100].
  // A segment can shrink to 0% but the dots can never cross/invert.
  const applyDot1 = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(pct, dot2));
    onChange({ cashPct: clamped, bondsPct: dot2 - clamped, equitiesPct: 100 - dot2 });
  }, [dot2, onChange]);

  const applyDot2 = useCallback((pct: number) => {
    const clamped = Math.max(dot1, Math.min(pct, 100));
    onChange({ cashPct: dot1, bondsPct: clamped - dot1, equitiesPct: 100 - clamped });
  }, [dot1, onChange]);

  useEffect(() => {
    if (dragging === null) return;
    const handleMove = (e: PointerEvent) => {
      const pct = pctFromClientX(e.clientX);
      if (dragging === 1) applyDot1(pct);
      else applyDot2(pct);
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, pctFromClientX, applyDot1, applyDot2]);

  const startDrag = (dot: 1 | 2) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    setDragging(dot);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold text-gray-800">
        Cash {cashPct.toFixed(0)}% / Bonds {bondsPct.toFixed(0)}% / Equities {equitiesPct.toFixed(0)}%
      </div>
      <div
        ref={barRef}
        className={`relative h-8 rounded-full overflow-hidden flex border border-gray-300 ${disabled ? 'opacity-50' : ''}`}
      >
        <div className={SEGMENT_COLOR.cash} style={{ width: `${cashPct}%` }} />
        <div className={SEGMENT_COLOR.bonds} style={{ width: `${bondsPct}%` }} />
        <div className={SEGMENT_COLOR.equities} style={{ width: `${equitiesPct}%` }} />

        <button
          type="button"
          aria-label="Cash / Bonds divider"
          onPointerDown={startDrag(1)}
          disabled={disabled}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-gray-700 shadow cursor-ew-resize touch-none disabled:cursor-not-allowed"
          style={{ left: `${dot1}%` }}
        />
        <button
          type="button"
          aria-label="Bonds / Equities divider"
          onPointerDown={startDrag(2)}
          disabled={disabled}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border-2 border-gray-700 shadow cursor-ew-resize touch-none disabled:cursor-not-allowed"
          style={{ left: `${dot2}%` }}
        />
      </div>
      <div className="grid grid-cols-3 text-xs text-gray-500 gap-2">
        <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-full ${SEGMENT_COLOR.cash}`} />Low return, very low volatility.</span>
        <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-full ${SEGMENT_COLOR.bonds}`} />Moderate return, moderate volatility.</span>
        <span className="flex items-center gap-1"><span className={`inline-block w-2 h-2 rounded-full ${SEGMENT_COLOR.equities}`} />Higher return, higher volatility.</span>
      </div>
    </div>
  );
}
