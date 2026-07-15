import { useState } from 'react';
import { Shield, Shuffle } from 'lucide-react';
import type { GameSetupSettings } from '../types/simulation';

interface SetupPageProps {
  onStart: (settings: GameSetupSettings) => void;
}

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
  const [gameLength, setGameLength] = useState(10);
  const [startingYear, setStartingYear] = useState(2026);
  const [instanceId, setInstanceId] = useState(() => randomInstanceId());

  function handleStart() {
    if (!poolName.trim()) return;
    onStart({ poolName: poolName.trim(), gameLength, startingYear, instanceId: instanceId.trim() || randomInstanceId() });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <Shield size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Risk Pool Simulation</h1>
          <p className="text-gray-500 max-w-md mx-auto text-sm leading-relaxed">
            Manage a public entity risk pool over multiple years. Make pricing, underwriting, investment, and reinsurance decisions to grow surplus and serve your members.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <h2 className="text-white font-bold text-lg">Game Setup</h2>
            <p className="text-blue-200 text-sm">Configure your simulation before starting</p>
          </div>

          <div className="p-6 space-y-6">
            {/* Pool Name */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Pool Name</label>
              <input
                type="text"
                value={poolName}
                onChange={e => setPoolName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="Enter a name for your pool..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Game Length */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Game Length: <span className="text-blue-600">{gameLength} years</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={20}
                  step={1}
                  value={gameLength}
                  onChange={e => setGameLength(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>3 years</span>
                  <span>20 years</span>
                </div>
              </div>

              {/* Starting Year */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Starting Year</label>
                <select
                  value={startingYear}
                  onChange={e => setStartingYear(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                >
                  {Array.from({ length: 13 }, (_, i) => 2023 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Controls calendar labels only</p>
              </div>
            </div>

            {/* Instance ID */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Instance ID / Seed</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={instanceId}
                  onChange={e => setInstanceId(e.target.value.toUpperCase().slice(0, 12))}
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition tracking-wider"
                  placeholder="e.g. ABC12345"
                />
                <button
                  type="button"
                  onClick={() => setInstanceId(randomInstanceId())}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg text-gray-600 transition flex items-center gap-1.5 text-sm font-medium"
                >
                  <Shuffle size={14} />
                  Randomize
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Same ID + same decisions = same results. Share this ID to compare strategies.</p>
            </div>

            {/* Info panel */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-blue-800 text-sm font-medium mb-2">What you will manage:</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-blue-700">
                <span>• Rate changes and premium adequacy</span>
                <span>• Underwriting strictness</span>
                <span>• Reinsurance protection levels</span>
                <span>• Investment risk strategy</span>
                <span>• Funding confidence level</span>
                <span>• Risk control investment</span>
                <span>• Dividends and assessments</span>
                <span>• Member retention and growth</span>
              </div>
            </div>

            <button
              onClick={handleStart}
              disabled={!poolName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-base transition-colors shadow-md"
            >
              Start Simulation
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          All member names and entities are fictional. No real public entity names are used.
        </p>
      </div>
    </div>
  );
}