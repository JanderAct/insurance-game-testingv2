import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LoanOffer } from '../utils/simulationEngine';
import { formatCurrency } from '../utils/formatters';
import { LINE_FULL_NAME } from '../utils/lineDisplay';

interface LoanPromptModalProps {
  offers: LoanOffer[];
  onResolve: (authorizedLines: string[]) => void;
}

// Prompts the player to authorize or decline an inter-line loan for each line
// that ended the year with a negative surplus. Defaults to authorize; the
// player can decline any line (which leaves it carrying a negative surplus).
export default function LoanPromptModal({ offers, onResolve }: LoanPromptModalProps) {
  const [authorized, setAuthorized] = useState<Record<string, boolean>>(
    () => Object.fromEntries(offers.map(o => [o.line, true]))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-amber-50">
          <AlertTriangle size={18} className="text-amber-600" />
          <h3 className="font-bold text-gray-900">Line Surplus Deficit</h3>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            {offers.length === 1 ? 'A coverage line' : 'One or more coverage lines'} ended
            the year with a negative surplus. You can authorize an inter-line loan — a real
            transfer from the other lines' invested assets, repaid to them with interest — to
            bring the line back to zero, or decline and let it carry the deficit forward
            (which blocks that line's dividend next year).
          </p>

          <div className="space-y-3">
            {offers.map(o => (
              <div key={o.line} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900">{LINE_FULL_NAME[o.line]}</span>
                  <span className="text-sm text-red-600 font-mono">
                    Deficit {formatCurrency(o.deficit)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-1">
                  Starting rate (the pool's asset-weighted blended investment return this year,
                  floored at 0% — it re-floats to the current rate each year the loan is
                  outstanding): <span className="font-semibold">{(o.rateAtOrigination * 100).toFixed(2)}%</span>
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  Funded by: {Object.entries(o.lenderShares)
                    .map(([l, s]) => `${LINE_FULL_NAME[l as keyof typeof LINE_FULL_NAME]} ${((s ?? 0) * 100).toFixed(0)}%`)
                    .join(', ')} — repayments (principal + interest) flow back to {Object.keys(o.lenderShares).length === 1 ? 'that line' : 'those lines'}.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAuthorized(a => ({ ...a, [o.line]: true }))}
                    className={`flex-1 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      authorized[o.line]
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    Authorize Loan
                  </button>
                  <button
                    onClick={() => setAuthorized(a => ({ ...a, [o.line]: false }))}
                    className={`flex-1 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      !authorized[o.line]
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onResolve(offers.filter(o => authorized[o.line]).map(o => o.line))}
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Confirm & Continue
          </button>
        </div>
      </div>
    </div>
  );
}
