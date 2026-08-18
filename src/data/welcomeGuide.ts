// Player-facing copy for the "Welcome to Ripple" modal on SetupPage.
// Kept as structured data (not inlined JSX) so the copy can be edited without
// touching component code. Source: 01A_WELCOME_TO_RIPPLE.md. Inline **bold**
// markers are parsed by WelcomeModal into <strong> spans.

export type WelcomeBlock =
  | { type: 'heading'; text: string }
  | { type: 'subheading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export const WELCOME_GUIDE_TITLE = 'Welcome to Ripple';

export const WELCOME_GUIDE: WelcomeBlock[] = [
  {
    type: 'paragraph',
    text: '**Ripple** is a multi-year public entity risk pool management simulation.',
  },
  {
    type: 'paragraph',
    text: 'You will create your own risk pool and guide it through a series of operating years. As the Pool’s management team, you will make decisions that affect its members, financial position, and long-term stability.',
  },
  {
    type: 'paragraph',
    text: 'Before the game begins, you will establish the basic structure of your Pool.',
  },
  { type: 'heading', text: 'Create Your Risk Pool' },
  { type: 'subheading', text: '1. Name Your Pool' },
  { type: 'paragraph', text: 'Choose a name for the risk pool you will manage.' },
  {
    type: 'paragraph',
    text: 'Your Pool’s name will appear throughout the game on financial statements, reports, and other management materials.',
  },
  { type: 'subheading', text: '2. Choose Your Starting Year' },
  { type: 'paragraph', text: 'Select the calendar year in which your Pool will begin operations.' },
  { type: 'paragraph', text: 'The starting year establishes the calendar used throughout your game.' },
  { type: 'subheading', text: '3. Choose Your Game Length' },
  { type: 'paragraph', text: 'Decide how many years you would like to manage your Pool.' },
  { type: 'paragraph', text: 'You may select a game lasting **3 to 10 years**.' },
  {
    type: 'paragraph',
    text: 'A shorter game places greater emphasis on the immediate effects of your decisions. A longer game provides more time for claims to develop, financial trends to emerge, and the long-term consequences of your strategy to become visible.',
  },
  { type: 'subheading', text: '4. Select Your Coverage Lines' },
  { type: 'paragraph', text: 'Your final setup decision is which lines of coverage your Pool will provide.' },
  { type: 'paragraph', text: 'Ripple includes three coverage lines:' },
  { type: 'subheading', text: "Workers' Compensation" },
  {
    type: 'paragraph',
    text: "Workers' Compensation provides benefits for employees who are injured or become ill as a result of their work. Losses can include medical treatment, wage replacement, rehabilitation, and other claim costs.",
  },
  {
    type: 'paragraph',
    text: "In Ripple, Workers' Compensation exposure is based on **member payroll**. Claims can remain open for several years, meaning decisions made today may continue to affect the Pool well into the future. Medical costs, wage levels, claim severity, and changes in the legal or regulatory environment can all influence this line over time.",
  },
  { type: 'subheading', text: 'General Liability' },
  {
    type: 'paragraph',
    text: 'General Liability protects members from claims brought by third parties arising from their operations and activities. These claims may involve bodily injury, property damage, or other allegations of liability against a public entity.',
  },
  {
    type: 'paragraph',
    text: 'In Ripple, General Liability exposure is also based on **member payroll**. Liability claims can take time to resolve and may be heavily influenced by litigation trends, large individual claims, legal decisions, and changes in the liability environment. Losses from older years may also develop differently than originally expected.',
  },
  { type: 'subheading', text: 'Property' },
  {
    type: 'paragraph',
    text: 'Property coverage protects the physical assets owned or operated by Pool members, including buildings and other insured property.',
  },
  {
    type: 'paragraph',
    text: 'In Ripple, Property exposure is based on **Total Insured Value** rather than payroll. Property losses generally emerge more quickly than Workers’ Compensation or General Liability claims, but the line can experience significant volatility. Fires, storms, wildfires, earthquakes, and other major events can produce large losses across multiple members in a single year.',
  },
  { type: 'heading', text: 'Build the Pool You Want to Manage' },
  { type: 'paragraph', text: 'You must select **at least one** coverage line, but you may choose any combination of the three.' },
  { type: 'paragraph', text: 'You can create:' },
  {
    type: 'list',
    items: [
      'a single-line Pool focused on one type of risk;',
      'a Pool offering two coverage lines; or',
      'a diversified Pool providing Workers’ Compensation, General Liability, and Property.',
    ],
  },
  {
    type: 'paragraph',
    text: 'Your coverage selections are established when the Pool is created and remain in place throughout the game.',
  },
  {
    type: 'paragraph',
    text: 'Each coverage line behaves differently. The risks, claim patterns, exposures, and financial results that are favorable for one line may not be favorable for another. If you choose multiple lines, you will need to consider both the performance of each individual line and the financial condition of the Pool as a whole.',
  },
  { type: 'heading', text: 'Begin the Game' },
  {
    type: 'paragraph',
    text: 'Once you have selected your **Pool name, starting year, game length, and coverage lines**, you are ready to begin.',
  },
  { type: 'paragraph', text: 'Select **Start Simulation** to create your Pool.' },
  {
    type: 'paragraph',
    text: 'You will then receive information about the organization you will be managing, its starting financial position, membership, and the conditions facing the Pool as you begin your first year.',
  },
  { type: 'paragraph', text: 'From there, the decisions are yours.' },
  { type: 'paragraph', text: '**Every decision creates impact.**' },
];
