// CALENDAR-YEAR CV, MATCHED-SEED, EITHER SIDE OF THE IBNER CUTOVER.
//
//   npx tsx scripts/diagnostics/ibner-clf-basis-report.ts
//   GAMES=50 npx tsx scripts/diagnostics/ibner-clf-basis-report.ts
//
// REPORTS. Gates nothing.
//
// ============================================================================
// WHAT THIS IS FOR. The CLF tables are derived from percentiles of
// netIncurredLoss / poolPremium (see clf-table-derive.ts), so IBNER — which
// adds variance to netIncurredLoss — could in principle require them to be
// re-derived. This measures the calendar-year CV on both branches with the
// SAME seeds and the same game count, with a 95% CI from a block bootstrap
// resampling whole GAMES (line-years within a game are not independent: the
// book and surplus persist).
//
// Run it on feature/ibner and on claims-distribution and compare. The parent
// figures baked into PARENT below were measured that way at 120 games.
//
// ============================================================================
// ⚠ AND IT ESTABLISHED THAT ONE OF THE THREE LINES CANNOT BE ANSWERED THIS WAY.
//
// WC's calendar CV is NOT STABLE at these sample sizes, on EITHER branch:
//
//              50 games   120 games
//   parent       0.2502      0.3211     <- the 50-game figure falls OUTSIDE
//   feature      0.3318      0.4599        the parent's own 120-game CI
//
// The parent fails its own confidence interval when the sample size changes,
// which means the interval is not describing the uncertainty that matters.
// WC's severity is UNCAPPED, so a single game containing a $200M+ claim moves
// the CV materially and such games are rare — the block bootstrap is honest
// about variation WITHIN the sample it has and blind to whether the sample
// contains a tail event at all.
//
// So "WC's CV moved outside the parent CI" is NOT evidence that IBNER changed
// WC's variance. It is evidence that this instrument cannot resolve WC. The
// question is settleable, but by RE-RUNNING THE DERIVATION (30,000 line-years,
// percentiles rather than a moment) rather than by a bigger CV comparison.
//
// GL and Property ARE stable across the same sample-size change (GL 0.7920 vs
// 0.8025, Property 0.4798 vs 0.4677 on the parent), so for those two lines the
// comparison below means what it appears to mean.
//
// This is the WORKING_PRACTICES pattern about gross-error detectors reassigned
// as precision instruments, found in the wild: the CV comparison is fine for
// "did variance change by a lot" and useless for "did it change by enough to
// matter", and nothing in the output says which question it is answering.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';
const LINES: CoverageLine[] = ['WC','GL','Property'];
const GAMES = Number(process.env.GAMES ?? 120), YEARS = 10;
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
const sd=(x:number[])=>{const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1));};
const cal: Record<string, number[]> = { WC:[],GL:[],Property:[] };
const perGame: Record<string, number[][]> = { WC:[],GL:[],Property:[] };
for (let g=0; g<GAMES; g++){
  const id=`CVM${g}`; const inst=generateGameInstance(id, 4_200_000+g*8117);
  const setup={poolName:'C',gameLength:YEARS,startingYear:2026,instanceId:id,activeLines:LINES};
  const {poolState,priorHistory}=runPriorHistory(inst,setup as never);
  let gs: GameState={setup:setup as never,instance:inst,currentYearNumber:1,isStarted:true,
    isComplete:false,poolState,lockedResults:[],currentDecisions:defaultDecisionSet(1),priorHistory};
  const mine: Record<string,number[]> = {WC:[],GL:[],Property:[]};
  for(let y=1;y<=YEARS;y++){
    const p=processYear(gs,defaultDecisionSet(y));
    for(const l of LINES){
      const r=(p.result as never as {byLine:Record<string,LineResultSet>}).byLine[l];
      if(r){cal[l].push(r.netIncurredLoss); mine[l].push(r.netIncurredLoss);}
    }
    gs={...gs,currentYearNumber:y+1,poolState:p.updatedPoolState,lockedResults:[...gs.lockedResults,p.result]};
  }
  for(const l of LINES) perGame[l].push(mine[l]);
}
function bootCV(games:number[][]):[number,number,number]{
  const flat=games.flat(); const point=sd(flat)/mean(flat);
  const B=600; const out:number[]=[]; let st=12345;
  const rnd=()=>{st=(Math.imul(1664525,st)+1013904223)>>>0;return st/4294967296;};
  for(let b=0;b<B;b++){
    const s:number[]=[];
    for(let i=0;i<games.length;i++) s.push(...games[Math.floor(rnd()*games.length)]);
    out.push(sd(s)/mean(s));
  }
  out.sort((a,b)=>a-b);
  return [point,out[Math.floor(0.025*B)],out[Math.floor(0.975*B)]];
}
const PARENT: Record<string,[number,number,number]> = {
  WC:[0.3211,0.2541,0.4076], GL:[0.8025,0.7192,0.8686], Property:[0.4677,0.4460,0.4875] };
console.log(`${GAMES} games x ${YEARS} years, matched seeds 4_200_000 + g*8117`);
console.log('line      |     CV | 95% CI (this branch)  | parent CV [95% CI]      | inside parent CI?');
for(const l of LINES){
  const [p,lo,hi]=bootCV(perGame[l]);
  const [pc,plo,phi]=PARENT[l];
  const inside = p>=plo && p<=phi;
  const verdict = l === 'WC'
    ? (inside ? 'inside — BUT SEE HEADER' : 'outside — BUT SEE HEADER')
    : (inside ? 'YES' : '*** NO ***');
  console.log(`${l.padEnd(9)} | ${p.toFixed(4)} | [${lo.toFixed(4)}, ${hi.toFixed(4)}] | ${pc.toFixed(4)} [${plo.toFixed(4)}, ${phi.toFixed(4)}] | ${verdict}`);
}
console.log('\n⚠ WC\'s ROW IS NOT INTERPRETABLE EITHER WAY — its CV is unstable across sample');
console.log('  size on BOTH branches (parent 0.2502 at 50 games against 0.3211 at 120, which');
console.log('  falls outside the parent\'s own CI). Read the header before drawing anything');
console.log('  from it. GL and Property are stable across the same change and do mean what');
console.log('  they say.');
