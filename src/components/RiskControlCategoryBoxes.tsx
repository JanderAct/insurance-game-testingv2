// ============================================================================
// THE FIVE RISK-CONTROL CATEGORY BOXES — A PREVIEW, BESIDE THE LIVE SLIDER.
//
// ⚠ INERT. These boxes take no value, emit no change, and touch no decision
// field. The LIVE control is the "Risk Control Investment" slider in the Loss
// Prevention card on this same tab; that slider is what spends money and what
// reaches the loss draw. Nothing here does anything yet.
//
// ⚠ DO NOT WIRE ONE TO THE OTHER. If you are here to make these work, the
// intended path is ONE commit that moves the spend from the slider to the boxes
// and deletes the slider in the same change — not a commit that makes a box set
// riskControlPct. Two controls writing one field is the arrangement where a
// player moves a box, the slider disagrees, and the engine takes whichever wrote
// last. See src/data/riskControlCategories.ts for the scoping and the reasoning.
//
// ⚠ AND THE COPY HERE MUST NOT CONTAIN THE STRING "Risk Control Investment".
// scripts/tools/session-drivers/full-session.cjs finds that slider by walking UP
// from every range input looking for its label text in an ancestor within five
// levels. These boxes sit in the same grid as that slider, so repeating its
// label here could make the driver nudge a different input entirely. The card is
// titled "Risk Control Programmes" for that reason and not for a nicer word.
// ============================================================================

import { Layers } from 'lucide-react';
import {
  RISK_CONTROL_CATEGORIES, benefitLabel, commitmentLabel,
  type RiskControlCategory,
} from '../data/riskControlCategories';

const SCOPE_STYLE: Record<string, string> = {
  WC: 'bg-sky-50 text-sky-700 border-sky-200',
  GL: 'bg-violet-50 text-violet-700 border-violet-200',
  Property: 'bg-amber-50 text-amber-700 border-amber-200',
  Pool: 'bg-gray-100 text-gray-600 border-gray-300',
};

function CategoryBox({ c }: { c: RiskControlCategory }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-gray-900 text-sm leading-tight">{c.name}</h4>
        <span className={`shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded border ${SCOPE_STYLE[c.scope]}`}>
          {c.scope}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700 font-medium">
          {commitmentLabel(c)}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
          {benefitLabel(c)}
        </span>
        {c.renewal === 'opt-out' && (
          <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700">
            Continues unless stopped
          </span>
        )}
        {c.status === 'placeholder' && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-800 font-medium">
            Placeholder
          </span>
        )}
      </div>

      <p className="text-xs text-gray-600 leading-snug">{c.what}</p>
      <p className="text-xs text-gray-500 leading-snug italic">{c.why}</p>
    </div>
  );
}

export default function RiskControlCategoryBoxes() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <span className="text-blue-600"><Layers size={16} /></span>
        <h3 className="font-bold text-gray-900 text-sm">Risk Control Programmes</h3>
        <span className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-300">
          Preview — not yet active
        </span>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-xs text-gray-500 leading-snug">
          A preview of how risk control is intended to be bought: as programmes with their own
          commitment lengths, rather than as one intensity. These boxes do nothing yet — the
          <span className="font-semibold text-gray-700"> Loss Prevention </span>
          card is the live control and is what spends money this year.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {RISK_CONTROL_CATEGORIES.map(c => <CategoryBox key={c.id} c={c} />)}
        </div>
      </div>
    </div>
  );
}
