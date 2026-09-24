// ============================================================================
// THE FIVE PROGRAM DESCRIPTIONS.
//
// ⚠ THE AUTHOR'S WORDS, VERBATIM. Not summarised, not reordered, not annotated,
// and nothing of this file's own is mixed in. Every character between the
// backticks below was supplied. If it needs to change, it changes because the
// author changed it.
//
// ⚠ THE ONLY THING THIS FILE DOES TO THEM IS PRESERVE THEIR LINE BREAKS.
// The copy was written with "Applies to:" and "Commitment:" on their own
// consecutive lines. Markdown joins consecutive lines into one paragraph, so
// rendered raw they would read "Applies to: Workers' Compensation Commitment: 3
// years" on a single line. riskControlMemo.ts converts each single newline to a
// markdown hard break so every line the author wrote is a line on the page.
// That is layout, not editing — no word, order or punctuation is touched, and
// the first line becomes the section heading.
//
// ⚠ AND THE NAMES HERE ARE AUTHORITATIVE. They differ from the short labels the
// compact tiles carried before this commit — "Law Enforcement Analytics" is now
// "Law Enforcement Early Intervention & Analytics", and the program this repo
// called "Claims Management System" is "Claims Management Modernization". The
// catalog's `name` is set from these; `tileName` is the abbreviation the narrow
// tile renders. See riskControlCategories.ts.
// ============================================================================

/** Keyed by RiskControlCategory.id. */
export const RISK_CONTROL_PROGRAM_COPY: Record<string, string> = {
  'wc-safety-rtw': `Workers' Compensation Safety & Return-to-Work Program

Applies to: Workers' Compensation
Commitment: 3 years

This program combines workplace safety initiatives with a structured return-to-work program for injured employees.

Services may include workplace assessments, safety committees, ergonomic reviews, supervisor training, and loss-control consultations. The return-to-work component focuses on helping injured employees resume productive work, including modified or transitional duty when appropriate.

The program is intended to affect Workers' Compensation results in two ways: by reducing the frequency of preventable workplace injuries and by reducing the duration and cost of claims after an injury occurs.

Benefits are expected to build over time as participating members implement safety practices and establish more effective return-to-work procedures. Continued participation is therefore more valuable than treating the program as a one-year initiative.`,

  'gl-law-enforcement-analytics': `Law Enforcement Early Intervention & Analytics

Applies to: General Liability
Commitment: 3 years

This program provides participating law enforcement agencies with tools to identify emerging patterns that may lead to significant liability claims.

The program tracks information such as use-of-force incidents, complaints, pursuits, stops, and other operational indicators. Patterns can then be reviewed by agency leadership so that additional supervision, training, policy review, or other intervention can occur when appropriate.

The program is designed primarily to reduce the likelihood and severity of significant law enforcement liability events rather than broadly reducing all General Liability claims.

The benefits develop gradually. The first stage focuses on establishing the system and collecting reliable information. As additional experience becomes available, agencies are better positioned to identify patterns and intervene before they result in more serious incidents.`,

  'property-mitigation': `Property Loss Prevention & Mitigation

Applies to: Property
Commitment: 2 years

This program focuses resources on physical improvements that can reduce the severity of property losses, particularly at higher-value or more vulnerable locations.

Projects may include roof improvements, water detection and automatic shutoff systems, wind protection, backup power, flood mitigation, and protection or relocation of critical equipment.

These improvements generally cannot prevent a wildfire, storm, earthquake, flood, or other external event from occurring. Their purpose is to reduce the amount of damage when an event does occur.

Unlike some other risk control programs, the value of property mitigation may not be visible every year. A protected location may experience no loss for several years, but the improvements can materially reduce the cost of a future event.`,

  'claims-management-system': `Claims Management Modernization

Applies to: All active coverage lines
Commitment: 3 years

This program modernizes the systems and processes used to manage claims throughout the Pool.

Improvements may include claims intake, adjuster workflow, reserve review, litigation management, reporting, documentation, and management information.

Unlike programs designed to prevent losses, Claims Management Modernization focuses on what happens after a claim occurs. Better claim handling can improve consistency, identify developing problems earlier, reduce unnecessary claim costs, and strengthen the information available to management.

Because implementation requires significant planning, system development, data conversion, and staff training, the benefits are not immediate. The value of the program increases as implementation progresses and the new processes become fully operational.

This program can benefit every active coverage line because it affects the way claims are administered throughout the Pool.`,

  'member-services': `Member Services & Risk Education

Applies to: All active coverage lines
Commitment: 1 year

This program expands the services available to Pool members through training, advisory support, model policies, educational programs, member hotlines, and other resources.

Its primary purpose is to strengthen the relationship between the Pool and its members and increase the value members receive from participation.

Unlike the other programs, Member Services is not modeled as directly reducing claim frequency or claim severity. Its principal benefit is member engagement and retention.

The program is funded one year at a time, allowing management to reconsider the level of investment each term.`,
};
