import { useId } from 'react';

// Vector recreation of the Ripple brand mark (concentric rings + colored
// dots). Built as SVG/JSX rather than a raster asset so it has a
// transparent background natively and stays crisp at any size.
//
// The gradient needs a unique id per instance — the mark is rendered in
// more than one place at once (header + setup hero), and a shared id
// would make both <use>s resolve to whichever <defs> is last in the DOM.
export function RippleMark({ className = '', size = 76 }: { className?: string; size?: number }) {
  const gradientId = `rippleArcGradient-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradientId} x1="10" y1="34" x2="68" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2DBFA7" />
          <stop offset="55%" stopColor="#79C242" />
          <stop offset="100%" stopColor="#2E7FD6" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" stroke="#2E7FD6" strokeWidth="3" />
      <path d="M 12 34 A 46 46 0 0 1 65 5" stroke={`url(#${gradientId})`} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="38" stroke="#8FC4EE" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="29" stroke="#132A4D" strokeWidth="6" />
      <circle cx="50" cy="50" r="20" stroke="#8FC4EE" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="12" fill="#132A4D" />
      <circle cx="73" cy="10" r="5.5" fill="#79C242" />
      <circle cx="85" cy="80" r="5.5" fill="#F0891E" />
      <circle cx="42" cy="95" r="5.5" fill="#3FB6E8" />
      <circle cx="5" cy="58" r="5.5" fill="#8B5FBF" />
    </svg>
  );
}

// Full lockup (mark + wordmark + tagline) for light backgrounds, e.g. the
// setup page hero.
export default function RippleLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-4 ${className}`}>
      <RippleMark />
      <div className="text-left">
        <div className="text-4xl font-extrabold tracking-tight text-[#132A4D] leading-none">RIPPLE</div>
        <div className="text-[#2E7FD6] text-xs font-semibold tracking-[0.18em] mt-1.5 whitespace-nowrap">
          EVERY DECISION CREATES IMPACT
        </div>
      </div>
    </div>
  );
}
