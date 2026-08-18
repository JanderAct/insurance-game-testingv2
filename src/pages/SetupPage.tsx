import { useState } from 'react';
import { Shuffle, BookOpen } from 'lucide-react';
import type { GameSetupSettings, CoverageLine } from '../types/simulation';
import RippleLogo from '../assets/RippleLogo';
import WelcomeModal from '../components/WelcomeModal';

interface SetupPageProps {
  onStart: (settings: GameSetupSettings) => void;
}

const COVERAGE_LINES: { value: CoverageLine; label: string; hint: string }[] = [
  { value: 'WC', label: "Workers' Compensation", hint: 'Payroll-based' },
  { value: 'GL', label: 'General Liability', hint: 'Payroll-based' },
  { value: 'Property', label: 'Property', hint: 'Total Insured Value' },
];

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
  const [activeLines, setActiveLines] = useState<CoverageLine[]>(['WC']);
  const [showWelcome, setShowWelcome] = useState(false);

  function toggleLine(line: CoverageLine) {
    setActiveLines(prev =>
      prev.includes(line) ? prev.filter(l => l !== line) : [...prev, line]
    );
  }

  function handleStart() {
    if (!poolName.trim() || activeLines.length === 0) return;
    // Preserve canonical WC/GL/Property order regardless of click sequence.
    const orderedLines = COVERAGE_LINES.map(l => l.value).filter(l => activeLines.includes(l));
    onStart({ poolName: poolName.trim(), gameLength, startingYear, instanceId: instanceId.trim() || randomInstanceId(), activeLines: orderedLines });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex items-center justify-center p-6">
      <div className="w-full max-w-[840px]">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-5">
            <RippleLogo />
          </div>
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
            {/* Welcome guide */}
            <button
              type="button"
              onClick={() => setShowWelcome(true)}
              className="w-full flex items-center gap-2.5 text-left border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-lg px-4 py-3 transition-colors"
            >
              <BookOpen size={18} className="text-blue-600 flex-shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-blue-800">New here? Read this first</span>
                <span className="block text-xs text-blue-600">A quick, optional guide to how Ripple works</span>
              </span>
            </button>

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

            {/* Coverage lines */}
            <div>
              <label className="block text-base font-semibold text-gray-700 mb-2">Coverage Lines</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {COVERAGE_LINES.map(line => {
                  const checked = activeLines.includes(line.value);
                  return (
                    <button
                      key={line.value}
                      type="button"
                      onClick={() => toggleLine(line.value)}
                      className={`flex items-start gap-3 text-left border rounded-lg px-4 py-3 transition ${
                        checked
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                          : 'border-gray-300 bg-white hover:border-blue-300'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center text-xs font-bold ${
                          checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-400 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-gray-800">{line.label}</span>
                        <span className="block text-xs text-gray-500">{line.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className={`text-sm mt-1.5 ${activeLines.length === 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {activeLines.length === 0
                  ? 'Select at least one coverage line.'
                  : 'Lines are chosen once at setup and locked for the game.'}
              </p>
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
              disabled={!poolName.trim() || activeLines.length === 0}
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

      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
  );
}