import { useState } from 'react';
import { Shield, Shuffle } from 'lucide-react';
import type { GameSetupSettings } from '../types/simulation';

interface SetupPageProps {
  onStart: (settings: GameSetupSettings) => void;
}

const MANAGED_ITEMS: { label: string; definition: string }[] = [
  { label: 'Rate changes and premium adequacy', definition: 'How much you raise or lower pool rates each year, balancing competitiveness against how well premium covers expected losses.' },
  { label: 'Underwriting strictness', definition: 'How selective the pool is when accepting new members. Stricter underwriting favors better risks but slows growth.' },
  { label: 'Reinsurance protection levels', definition: 'How much of your losses are transferred to a reinsurer in exchange for a cost, reducing volatility and protecting surplus.' },
  { label: 'Investment risk strategy', definition: 'How aggressively the pool invests its assets. Higher risk offers higher expected returns but more volatility and downside risk.' },
  { label: 'Funding confidence level', definition: 'The percentile of the loss distribution your funding is designed to cover. Higher confidence means more conservative, and costlier, funding.' },
  { label: 'Risk control investment', definition: 'Spending on loss-prevention programs (safety, training, inspections) that gradually reduce expected losses over time.' },
  { label: 'Dividends and assessments', definition: 'Returning surplus to members as dividends, or collecting additional funding from members through assessments when needed.' },
  { label: 'Member retention and growth', definition: 'How many members stay in or join the pool, driven by pricing, satisfaction, and the pool’s financial performance.' },
];

function randomInstanceId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export default function SetupPage({ onStart }: SetupPageProps) {
  const [poolName, setPoolName] = useState('Clearwater Public Entity Pool');
  const [gameLength, setGameLength] = useState(5);
  const [startingYear, setStartingYear] = useState(2026);
  const [instanceId, setInstanceId] = useState(() => randomInstanceId());

  function handleStart() {
    if (!poolName.trim()) return;
    onStart({ poolName: poolName.trim(), gameLength, startingYear, instanceId: instanceId.trim() || randomInstanceId() });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center p-6">
      <div className="w-full max-w-[840px]">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-2xl shadow-lg mb-5">
            <Shield size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Risk Pool Simulation</h1>
          <p className="text-gray-500 max-w-lg mx-auto text-base leading-relaxed">
            Manage a public entity risk pool over multiple years. Make pricing, underwriting, investment, and reinsurance decisions to grow surplus and serve your members.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-5">
            <h2 className="text-white font-bold text-xl">Game Setup</h2>
            <p className="text-blue-200 text-base">Configure your simulation before starting</p>
          </div>

          <div className="p-8 space-y-7">
            {/* Pool Name */}
            <div>
              <label className="block text-base font-semibold text-gray-700 mb-2">Pool Name</label>
              <input
                type="text"
                value={poolName}
                onChange={e => setPoolName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-5 py-3 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="Enter a name for your pool..."
              />
            </div>

            <div className="grid grid-cols-2 gap-5">
              {/* Game Length */}
              <div>
                <label className="block text-base font-semibold text-gray-700 mb-2">
                  Game Length: <span className="text-blue-600">{gameLength} years</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={10}
                  step={1}
                  value={gameLength}
                  onChange={e => setGameLength(parseInt(e.target.value))}
                  className="w-full accent-blue-600 h-2"
                />
                <div className="flex justify-between text-sm text-gray-400 mt-1.5">
                  <span>3 years</span>
                  <span>10 years</span>
                </div>
              </div>

              {/* Starting Year */}
              <div>
                <label className="block text-base font-semibold text-gray-700 mb-2">Starting Year</label>
                <select
                  value={startingYear}
                  onChange={e => setStartingYear(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-5 py-3 text-base text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                >
                  {Array.from({ length: 13 }, (_, i) => 2023 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <p className="text-sm text-gray-400 mt-1.5">Controls calendar labels only</p>
              </div>
            </div>

            {/* Instance ID */}
            <div>
              <label className="block text-base font-semibold text-gray-700 mb-2">Instance ID / Seed</label>
              <div className="flex gap-2.5">
                <input
                  type="text"
                  value={instanceId}
                  onChange={e => setInstanceId(e.target.value.toUpperCase().slice(0, 12))}
                  className="flex-1 border border-gray-300 rounded-lg px-5 py-3 text-base font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition tracking-wider"
                  placeholder="e.g. ABC12345"
                />
                <button
                  type="button"
                  onClick={() => setInstanceId(randomInstanceId())}
                  className="px-5 py-3 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-600 transition flex items-center gap-2 text-base font-medium"
                >
                  <Shuffle size={16} />
                  Randomize
                </button>
              </div>
              <p className="text-sm text-gray-400 mt-1.5">Same ID + same decisions = same results. Share this ID to compare strategies.</p>
            </div>

            {/* Info panel */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
              <p className="text-blue-800 text-base font-medium mb-3">What you will manage:</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-blue-700">
                {MANAGED_ITEMS.map(item => (
                  <span key={item.label} className="relative group inline-flex items-center gap-1 cursor-help w-fit">
                    • <span className="underline decoration-dotted decoration-blue-400">{item.label}</span>
                    <span className="pointer-events-none absolute bottom-full left-0 mb-2 w-64 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity">
                      <span className="block bg-gray-900 text-white text-sm font-normal leading-relaxed rounded-lg px-3.5 py-2.5 shadow-lg">
                        {item.definition}
                      </span>
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={!poolName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl text-lg transition-colors shadow-md"
            >
              Start Simulation
            </button>
          </div>
        </div>

        <p className="text-center text-sm text-gray-400 mt-5">
          All member names and entities are fictional. No real public entity names are used.
        </p>
      </div>
    </div>
  );
}