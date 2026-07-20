import type { Member, MemberType, SizeCategory } from '../types/simulation';

const MEMBER_TYPES: MemberType[] = [
  'City',
  'County',
  'Fire District',
  'Water District',
  'Transit Authority',
  'School District',
  'Park District',
  'Recreation District',
  'Special District',
];

const PLACE_NAMES = [
  'Northvale', 'Southgate', 'Eastbrook', 'Westfield', 'Lakewood',
  'Riverside', 'Crestview', 'Pinehurst', 'Oakdale', 'Maplewood',
  'Elmwood', 'Cedarview', 'Birchwood', 'Willowbrook', 'Stonegate',
  'Hillcrest', 'Fairview', 'Clearwater', 'Greenvale', 'Springdale',
];

function sizeForIndex(index: number): SizeCategory {
  if (index < 55) return 'Small';
  if (index < 85) return 'Medium';
  if (index < 97) return 'Large';
  return 'Very Large';
}

function exposureFor(index: number, size: SizeCategory): number {
  const position = index % 10;
  const ranges: Record<SizeCategory, [number, number]> = {
    Small: [0.45, 1.45],
    Medium: [1.75, 3.95],
    Large: [4.5, 9.5],
    'Very Large': [11.5, 17.5],
  };
  const [min, max] = ranges[size];
  return Number((min + (max - min) * (position / 9)).toFixed(2));
}

// This catalog is deliberately independent of the game seed. Every game uses
// the same 100 entities, payrolls, and baseline risk characteristics; the seed
// only determines which entities begin in the pool.
export const PREDEFINED_MARKET_MEMBERS: ReadonlyArray<Member> = Array.from(
  { length: 100 },
  (_, index) => {
    const type = MEMBER_TYPES[index % MEMBER_TYPES.length];
    const sizeCategory = sizeForIndex(index);
    const sequence = String(index + 1).padStart(3, '0');

    return {
      id: `member-${sequence}`,
      name: `${PLACE_NAMES[index % PLACE_NAMES.length]} ${type} ${sequence}`,
      type,
      sizeCategory,
      // GL rides on the same payroll figure as WC — one payroll number per
      // member drives both lines (public-entity pools don't have a separate
      // commercial-style revenue base for GL).
      exposureByLine: { WC: exposureFor(index, sizeCategory), GL: exposureFor(index, sizeCategory) },
      yearJoined: 0,
      calendarYearJoined: 0,
      riskQuality: Number((2 + ((index * 37) % 66) / 10).toFixed(1)),
      satisfaction: Number((6.2 + ((index * 19) % 23) / 10).toFixed(1)),
      status: 'prospect',
    };
  }
);

export function getPredefinedMarketMembers(): Member[] {
  return PREDEFINED_MARKET_MEMBERS.map(member => ({ ...member }));
}
