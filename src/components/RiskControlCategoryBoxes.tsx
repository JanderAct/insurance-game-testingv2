// ============================================================================
// THE FIVE RISK-CONTROL CATEGORY BOXES — STILL INERT, AND NOW THE ONLY
// RISK-CONTROL UI ON THE PAGE.
//
// ⚠ INERT. These boxes take no value, emit no change, and touch no decision
// field. Nothing here does anything yet.
//
// ⚠ AND THE SLIDER THEY SAT BESIDE IS GONE. Until the previous commit the Loss
// Prevention card carried a live "Risk Control Investment" slider and this
// header pointed at it. It is retired. `decisions.riskControlPct` REMAINS in the
// decision set, is still read by the engine, and is now pinned at its default of
// 0 — so the pool spends nothing on risk control until these boxes are given the
// field. The control went, not the decision.
//
// ⚠ DO NOT WIRE A BOX TO riskControlPct AS A HALF-STEP. The intended path is ONE
// commit that gives the boxes the field outright. A box that sets the old
// percentage would reintroduce the arrangement the retirement just removed —
// two representations of one spend, with the engine taking whichever wrote last.
// See src/data/riskControlCategories.ts for the scoping and the reasoning.
//
// ⚠ THE COPY HERE STILL MUST NOT CONTAIN THE STRING "Risk Control Investment",
// and the reason OUTLIVED the slider. Two drivers —
// session-drivers/full-session.cjs and session-drivers/replay-fidelity.cjs —
// find a slider by walking UP from every range input looking for its label text
// in an ancestor within five levels. Both were repointed to "Funding Confidence
// Level" when the slider went. Putting either label into this card's copy would
// put matching text in an ancestor of a real range input and let a driver nudge
// something it did not mean to, which is the collision the card's title was
// chosen to avoid in the first place.
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
          commitment lengths, rather than as one intensity. These boxes do nothing yet, and the
          intensity slider they replace has been retired — so the pool is
          <span className="font-semibold text-gray-700"> spending nothing on risk control </span>
          until these become active.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {RISK_CONTROL_CATEGORIES.map(c => <CategoryBox key={c.id} c={c} />)}
        </div>
      </div>
    </div>
  );
}
