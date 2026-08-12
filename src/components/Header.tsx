import { Shield, RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import type { GameState } from '../types/simulation';
import { formatCurrency, formatPct } from '../utils/formatters';

interface HeaderProps {
  gameState: GameState | null;
  startingFinancials?: { surplus: number; annualPremium: number; marketShare: number } | null;
  onNewGame: () => void;
  onAdvanceYear: () => void;
  canAdvance: boolean;
}

export default function Header({ gameState, startingFinancials, onNewGame, onAdvanceYear, canAdvance }: HeaderProps) {
  const lastResult = gameState?.lockedResults?.[gameState.lockedResults.length - 1];

  const surplus = lastResult?.endingSurplus ?? startingFinancials?.surplus ?? 0;
  const poolLossRatio = lastResult ? lastResult.poolLosses / Math.max(lastResult.poolPremium, 1) : undefined;
  const marketShare = lastResult?.marketShare ?? startingFinancials?.marketShare ?? 0;
  const poolName = gameState?.setup?.poolName ?? 'Risk Pool';
  const instanceId = gameState?.instance?.instanceId ?? '—';
  const yearNumber = gameState?.currentYearNumber ?? 1;
  const calendarYear = gameState
    ? gameState.setup.startingYear + gameState.currentYearNumber - 1
    : '—';
  const isStarted = gameState?.isStarted ?? false;
  const isComplete = gameState?.isComplete ?? false;

  return (
    <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-40">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: branding */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-blue-600 rounded-lg p-2 flex-shrink-0">
              <Shield size={20} />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-lg leading-tight truncate">Ripple</div>
              {/* Same slot, two occupants that never overlap: the tagline
                  before a game exists, the SIMULATED pool's own name once one
                  does. The pool-name branch is untouched — it names the game
                  in progress, not the product, and stays that way on rename. */}
              {isStarted ? (
                <div className="text-slate-400 text-xs truncate">{poolName}</div>
              ) : (
                <div className="text-slate-400 text-xs truncate">Every decision creates impact.</div>
              )}
            </div>
          </div>

          {/* Center: game state chips */}
          {isStarted && (
            <div className="flex items-center gap-3 flex-wrap">
              <Chip label="Year" value={`${yearNumber}`} />
              <Chip label="Calendar" value={`${calendarYear}`} />
              <Chip label="Instance" value={instanceId} mono />
              <Chip
                label="Surplus"
                value={formatCurrency(surplus, true)}
                valueClass={surplus >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              {poolLossRatio !== undefined && (
                <Chip
                  label="Pool Loss Ratio"
                  value={formatPct(poolLossRatio)}
                  valueClass={
                    poolLossRatio < 0.90 ? 'text-emerald-400' :
                    poolLossRatio < 1.10 ? 'text-amber-400' : 'text-red-400'
                  }
                />
              )}
              <Chip
                label="Market Share"
                value={formatPct(marketShare)}
                valueClass="text-sky-400"
              />
            </div>
          )}

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onNewGame}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium transition-colors"
            >
              <RefreshCw size={14} />
              New Game
            </button>
            {isStarted && !isComplete && (
              <button
                onClick={onAdvanceYear}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold transition-colors"
              >
                Lock Year {yearNumber}
                <ChevronRight size={14} />
              </button>
            )}
            {isComplete && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-sm font-medium">
                <AlertCircle size={14} />
                Game Complete
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Chip({
  label,
  value,
  valueClass = 'text-white',
  mono = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-slate-800 rounded-lg px-3 py-1.5 flex flex-col items-center min-w-[80px]">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className={`text-sm font-bold ${valueClass} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
