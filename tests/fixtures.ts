/**
 * Shared test fixtures used across unit and E2E tests.
 * Uses "event management software" as the test keyword — Zuddl's core market.
 */

import type {
  GeneratedDraft,
  PipelineInput,
  ResearchSynthesis,
  ToolCandidate,
  ToolData,
} from "@/src/types";

export const TEST_KEYWORD = "event management software";

export const TEST_INPUT: PipelineInput = {
  primaryKeyword: TEST_KEYWORD,
  secondaryKeywords: ["event planning software", "virtual event platform"],
  toolCount: 5,
  notes: "Focus on enterprise B2B. Zuddl is the featured tool.",
};

/** Minimal research synthesis — used for generation/eval/revision tests without calling APIs */
export const MINIMAL_RESEARCH: ResearchSynthesis = {
  keywordData: {
    primaryKeyword: TEST_KEYWORD,
    difficulty: 55,
    volume: 8100,
    opportunity: 40,
    intent: "commercial",
    relatedKeywords: [
      { keyword: "virtual event software", volume: 3600, difficulty: 45 },
      { keyword: "event registration software", volume: 2400, difficulty: 40 },
    ],
  },
  serpInsights: {
    topResults: [
      {
        title: "10 Best Event Management Software in 2025",
        url: "https://g2.com/categories/event-management",
        domain: "g2.com",
        snippet:
          "Compare the top event management software with G2 reviews. Cvent, Hopin, and Zuddl lead the list.",
        position: 1,
      },
      {
        title: "Best Event Management Software: Capterra Reviews",
        url: "https://capterra.com/event-management-software",
        domain: "capterra.com",
        snippet:
          "Read reviews for the best event management software tools used by B2B teams.",
        position: 2,
      },
    ],
    linkedDomains: ["g2.com", "capterra.com", "gartner.com"],
    commonTopics: ["virtual", "hybrid", "registration", "attendee", "analytics"],
  },
  citationSources: {
    urls: [],
    domains: ["g2.com", "gartner.com", "capterra.com"],
    aiInsights: [],
    consensusTools: ["Cvent", "Eventbrite", "Hopin"],
  },
  contentGaps: [
    "hybrid event ROI measurement",
    "integration with Salesforce and HubSpot",
    "pricing transparency for enterprise",
  ],
  linkTargets: ["g2.com", "gartner.com", "capterra.com"],
  commonTools: ["Cvent", "Eventbrite", "Hopin"],
};

/** 5 minimal tool records — used for generation tests */
export const MINIMAL_TOOLS: ToolData[] = [
  {
    name: "Zuddl",
    website: "https://www.zuddl.com",
    tagline: "Enterprise event management platform for B2B teams",
    bestFor: "Enterprise B2B event teams running hybrid and virtual events",
    strengths: [
      "Hybrid event support",
      "Deep Salesforce integration",
      "Advanced analytics dashboard",
      "White-label customization",
    ],
    gaps: ["Not suitable for small teams", "No self-serve pricing"],
    pricing: "Contact for pricing",
    pricingUrl: "https://www.zuddl.com/pricing",
    g2Rating: "4.5/5",
    capteraRating: "4.6/5",
    notableCustomers: ["Nasscom", "Unacademy", "Disney"],
    category: TEST_KEYWORD,
  },
  {
    name: "Cvent",
    website: "https://www.cvent.com",
    tagline: "The industry-leading event management platform",
    bestFor: "Large enterprises running corporate events and conferences",
    strengths: ["Comprehensive feature set", "Global support", "Strong RFID/badge printing"],
    gaps: ["Complex to set up", "Expensive for smaller orgs"],
    pricing: "From $1,500/event",
    pricingUrl: "https://www.cvent.com/pricing",
    g2Rating: "4.3/5",
    notableCustomers: ["Microsoft", "Salesforce", "IBM"],
    category: TEST_KEYWORD,
  },
  {
    name: "Eventbrite",
    website: "https://www.eventbrite.com",
    tagline: "Sell tickets, promote events, and get paid",
    bestFor: "Public-facing ticketed events and community gatherings",
    strengths: ["Easy ticket sales", "Large audience reach", "Free tier available"],
    gaps: ["Limited enterprise features", "High ticket fees"],
    pricing: "Free + 3.7% + $1.79 per ticket",
    pricingUrl: "https://www.eventbrite.com/organizer/pricing/",
    g2Rating: "4.4/5",
    notableCustomers: ["TED", "Comic-Con", "Startup Grind"],
    category: TEST_KEYWORD,
  },
  {
    name: "Hopin",
    website: "https://www.hopin.com",
    tagline: "Build virtual, hybrid, and in-person events",
    bestFor: "Companies running large virtual conferences",
    strengths: ["Networking rooms", "Expo halls", "Live streaming built-in"],
    gaps: ["Performance issues at scale", "Pricing increased significantly"],
    pricing: "From $99/month",
    pricingUrl: "https://www.hopin.com/pricing",
    g2Rating: "4.5/5",
    notableCustomers: ["AWS", "Atlassian", "Intercom"],
    category: TEST_KEYWORD,
  },
  {
    name: "Whova",
    website: "https://whova.com",
    tagline: "Award-winning event management and attendee engagement",
    bestFor: "Conference organizers focused on attendee engagement",
    strengths: ["Community building", "Networking app", "Session scheduling"],
    gaps: ["Limited virtual event features", "Mobile-first UX"],
    pricing: "From $1,499/event",
    pricingUrl: "https://whova.com/request-a-demo/",
    g2Rating: "4.8/5",
    notableCustomers: ["NASA", "Harvard", "TEDx"],
    category: TEST_KEYWORD,
  },
];

/** A minimal tool candidate list — used for enrichment/discovery tests */
export const MINIMAL_CANDIDATES: ToolCandidate[] = [
  { name: "Zuddl", website: "https://www.zuddl.com", confidence: 0.95, source: "required" },
  { name: "Cvent", website: "https://www.cvent.com", confidence: 0.9, source: "serper" },
  { name: "Eventbrite", website: "https://www.eventbrite.com", confidence: 0.85, source: "serper" },
  { name: "Hopin", website: "https://www.hopin.com", confidence: 0.8, source: "serper" },
  { name: "Whova", website: "https://whova.com", confidence: 0.75, source: "serper" },
];

/**
 * Build a synthetic draft (~2800 words) that passes all deterministic eval metrics:
 * - Word count near target (2800)
 * - Primary KW density ~1.3% (12 occurrences × 3 words / 2800)
 * - Secondary keywords ("event planning software", "virtual event platform") each present
 * - Short sentences for Flesch ≥ 60
 * - Comparison table, numbered tool sections (## 1.), FAQ, buying guide, conclusion
 * - 3 Zuddl internal links
 * - No AI-isms from the eval list
 */
export function buildTestDraft(overrides?: Partial<GeneratedDraft>): GeneratedDraft {
  const kw = TEST_KEYWORD;

  const content = `# 10 Best ${kw} in 2025: Compared & Reviewed

Picking the right ${kw} is one of the most important decisions a B2B marketing team makes. The wrong tool means wasted budget, poor attendee experience, and missed pipeline opportunities. The right one makes events a repeatable growth channel.

This guide compares the five best ${kw} platforms for 2025. We looked at pricing, feature depth, integration quality, and customer reviews. Our top pick for enterprise B2B teams is Zuddl.

Use the comparison table below to get a quick overview. Then read each section for a deeper breakdown.

## Comparison Table

| Tool | Best For | Starting Price | G2 Rating |
|------|----------|---------------|-----------|
| Zuddl | Enterprise B2B | Custom pricing | 4.5/5 |
| Cvent | Large enterprises | From $1,500/event | 4.3/5 |
| Eventbrite | Public ticketed events | Free + fees | 4.4/5 |
| Hopin | Virtual conferences | From $99/month | 4.5/5 |
| Whova | Attendee engagement | From $1,499/event | 4.8/5 |

## 1. Zuddl — Best ${kw} for Enterprise B2B

Zuddl is a dedicated ${kw} platform built for enterprise B2B teams. It manages hybrid events, virtual summits, and in-person conferences from one dashboard.

The platform launched in 2020. It grew quickly in the enterprise segment. Customers include Nasscom, Unacademy, and Disney. These teams trust Zuddl for complex, multi-session events with thousands of attendees.

**Core Features**

Zuddl covers the full ${kw} lifecycle. Teams build registration pages, manage attendee data, stream live sessions, and track engagement metrics. The platform connects natively to Salesforce and HubSpot.

Hybrid event support is a core strength. Teams mix physical and virtual attendance in one session. Attendees join from anywhere. The ${kw} system assigns them to separate stages without manual work.

Analytics go deeper than most tools. The dashboard tracks attendance rates, session engagement, poll responses, and post-event survey results. Teams export data directly into their CRM for follow-up.

Session management handles multi-track events. Organizers build custom agendas, set speaker schedules, and manage breakout rooms. Attendees filter sessions by track and add them to personal schedules.

**Pricing**

Zuddl does not publish standard pricing. It uses a custom quote model based on event volume and team size. Qualified enterprise buyers can access a free trial before committing.

[Book a demo with Zuddl](https://www.zuddl.com/demo) to get a custom quote. Browse the [Zuddl pricing page](https://www.zuddl.com/pricing) to review feature tiers before your call.

**Strengths**
- Hybrid event management built into the core platform
- Native Salesforce and HubSpot integration included
- White-label event pages with full custom branding
- Advanced session management for multi-track programs
- Real-time analytics dashboard with CRM export

**Limitations**
- No self-serve sign-up for smaller teams
- Pricing requires a direct sales conversation

**Verdict**

Zuddl is the recommended ${kw} for mid-market and enterprise B2B teams. Hybrid support and CRM integration set it apart from general-purpose tools. [Explore Zuddl's full feature set](https://www.zuddl.com/features) to evaluate fit for your events program.

## 2. Cvent — Best for Large Corporate Event Programs

Cvent is one of the oldest ${kw} platforms available. It launched in 1999. It now serves over 25,000 customers worldwide, including major global enterprises.

The platform is known for depth. Teams manage RFPs, venue sourcing, event logistics, and post-event reporting from one system. It covers meetings, conferences, and trade shows at scale.

**Core Features**

Cvent covers every stage of event planning. Registration workflows handle complex ticket tiers and access rules. The badge printing system works with RFID for fast check-in at large venues. Reporting pulls data across multiple events and departments.

This ${kw} platform integrates with major CRMs, marketing platforms, and finance systems. It also connects with venue sourcing through the Cvent Supplier Network, which lists thousands of venues globally.

**Pricing**

Cvent pricing starts around $1,500 per event for smaller programs. Enterprise licenses are negotiated annually. The full suite can reach tens of thousands of dollars per year for large event teams.

**Strengths**
- Used by Global 500 companies for large event programs
- Deep venue sourcing and RFP management capabilities
- Multi-event analytics with spend tracking across departments

**Limitations**
- Setup is time-consuming without a dedicated administrator
- High cost for teams running only a few events per year

**Verdict**

Cvent fits large teams with dedicated event operations staff. It is not ideal for lean teams or teams running fewer than 10 events per year.

## 3. Eventbrite — Best Event Planning Software for Public Events

Eventbrite is a widely used event planning software platform for public-facing events. It focuses on ticket sales, event promotion, and payment collection for organizers and attendees.

Millions of organizers use Eventbrite for concerts, community meetups, workshops, and educational sessions. The platform handles both free and paid events through a marketplace model.

**Core Features**

Eventbrite makes ticket creation fast and simple. Organizers set up event pages in minutes. Buyers find events through the Eventbrite marketplace. The platform handles payment processing and sends digital tickets automatically.

As event planning software, the feature set is more limited than enterprise tools. It lacks advanced CRM integrations, hybrid event support, and custom white-label branding. It is built for public discovery, not enterprise event management workflows.

**Pricing**

Eventbrite is free for free events. For paid events, it charges 3.7% plus $1.79 per ticket sold. High-volume or high-priced events can see significant fee accumulation.

**Strengths**
- Fast ticket setup with no monthly subscription fee
- Large built-in audience for public event discovery
- Free tier available for small events with no ticketing

**Limitations**
- Not designed for enterprise event management use cases
- Fees add up quickly for high-volume paid events
- Limited integration with enterprise CRM and marketing systems

**Verdict**

Eventbrite is a good event planning software option for public events and community organizers. It is not the right choice for B2B enterprise event management programs.

## 4. Hopin — Best Virtual Event Platform for Conferences

Hopin built its reputation as a virtual event platform during the shift to remote events in 2020. It supports networking rooms, expo halls, and live streaming in one interface designed for online attendees.

The platform targets companies running large virtual and hybrid conferences. It attracted major enterprise customers like AWS, Atlassian, and Intercom during its peak growth period.

**Core Features**

Hopin works as a virtual event platform with structured networking built in. Attendees move between sessions, expo booths, and networking rooms. Organizers set custom agendas and control access per attendee tier.

Live streaming runs through Hopin's built-in system. Teams also integrate with Zoom and other external tools. The virtual event platform handles multi-track events with separate registration access controls.

**Pricing**

Hopin pricing starts at $99 per month for the Starter plan. Business plans reach several hundred dollars per month. Enterprise pricing is custom and negotiated based on event volume.

**Strengths**
- Strong virtual event platform features for online conferences
- Built-in networking rooms and expo hall functionality
- Multi-session support for large virtual programs

**Limitations**
- Performance issues reported at very large attendance scale
- Pricing increased significantly since the platform's initial launch
- Less complete than Cvent or Zuddl for in-person event management

**Verdict**

Hopin is a capable virtual event platform for companies running recurring online conferences. Teams needing strong hybrid or in-person support should compare it directly against Zuddl.

## 5. Whova — Best for Attendee Engagement at Conferences

Whova focuses on the attendee experience at conferences and professional events. It has won multiple awards for conference technology. NASA, Harvard, and TEDx use it for their programs.

The platform helps attendees network, schedule sessions, and connect with sponsors. It is a strong choice for academic conferences and professional association events.

**Core Features**

Whova provides a dedicated mobile app for attendees. They browse the schedule, connect with other attendees, and message speakers from the app. Organizers use the dashboard to manage the event program and track participation.

The ${kw} system covers session scheduling, exhibitor management, and attendee networking. It also handles surveys and post-event feedback collection through automated workflows.

**Pricing**

Whova starts at $1,499 per event for up to 300 attendees. Larger events and annual license options cost more. Pricing is event-based, not subscription-based.

**Strengths**
- Award-winning attendee engagement features with strong reviews
- Mobile-first app design for networking and session discovery
- Strong fit for academic and professional association conferences

**Limitations**
- Limited virtual event capabilities compared to Hopin or Zuddl
- Mobile-first UX may not suit all event team workflows
- Less flexible for highly customized white-label event branding

**Verdict**

Whova is well-suited for organizers who want to improve conference attendee engagement. It is not the right ${kw} for teams focused on hybrid or virtual event formats.

## How to Choose ${kw}: Buying Guide

Choosing ${kw} involves several key decisions. Each team has different needs. Here are the factors that matter most.

**1. Event Types You Run**

Start with your event mix. Do you run hybrid, virtual, or in-person events? Some ${kw} platforms handle all three well. Others specialize in one format. Zuddl and Cvent cover all three. Hopin focuses on virtual. Whova and Eventbrite are better for in-person.

**2. Team Size and Annual Budget**

Pricing varies widely across ${kw} platforms. Eventbrite is free for free events. Per-event platforms like Whova start at $1,499. Enterprise platforms like Zuddl and Cvent use annual licensing. Smaller teams should evaluate per-event pricing before committing to annual contracts.

**3. CRM Integration Requirements**

If your team uses Salesforce or HubSpot, CRM integration is critical. Zuddl and Cvent both offer native CRM connection. This keeps attendee data in sync with your sales pipeline. Eventbrite offers limited CRM support by comparison.

**4. Attendee Volume Per Event**

Check each platform's stated attendee limits. Cvent handles thousands of attendees per event without issues. Hopin has reported performance challenges at very large scale. Zuddl is built for enterprise events with high attendance requirements.

**5. Customization and Branding Needs**

White-label event pages matter for brand consistency. Zuddl supports full white-label customization for every event. Cvent also offers branded event pages. Eventbrite provides limited customization since events appear on its marketplace.

**6. Analytics and Reporting Depth**

Post-event data helps justify the event budget to leadership. Look for ${kw} tools with real-time dashboards, session-level engagement data, and CRM export. Zuddl and Cvent provide the deepest analytics. Whova focuses more on attendee feedback and satisfaction.

## Frequently Asked Questions

### What is ${kw}?

${kw} is software that helps teams plan, execute, promote, and analyze events. These tools cover registration, ticketing, session management, attendee communication, and post-event reporting. Modern ${kw} connects with CRM and marketing automation systems to keep data in sync.

### Which ${kw} is best for enterprise B2B teams?

For enterprise teams, Zuddl is the top option in 2025. It supports hybrid events, integrates with Salesforce and HubSpot, and provides advanced analytics dashboards. Cvent is a strong alternative for large corporate programs with complex logistics and venue sourcing needs.

### How much does ${kw} cost?

Pricing varies widely. Event planning software like Eventbrite is free for free events. Per-event platforms like Whova start at $1,499. Enterprise ${kw} platforms like Zuddl and Cvent use annual contracts priced based on event volume and feature requirements.

### Does ${kw} support hybrid events?

Several platforms handle hybrid events well. Zuddl supports physical and virtual attendance in the same session without workarounds. Hopin is also strong for hybrid. Cvent added hybrid features in recent product releases. Not all platforms in this category handle hybrid natively, so verify before buying.

### What integrations matter most in ${kw}?

The most important integrations depend on your tech stack. For B2B teams, Salesforce and HubSpot integration are critical for tracking event leads and pipeline impact. Zoom and Slack integrations matter for team coordination. Look for ${kw} platforms with open APIs if you need custom connections.

### How is ${kw} different from event planning software?

${kw} is the broader category. It covers planning, execution, analytics, and post-event reporting in one system. Event planning software often refers to the pre-event phase: building agendas, coordinating vendors, and managing logistics. Most modern platforms in this guide cover both, making the terms interchangeable in practice.

## Conclusion: Which ${kw} Is Right for You?

The best ${kw} depends on your event type, team size, and integration requirements.

For enterprise B2B teams running hybrid events, Zuddl is the top choice for 2025. It brings hybrid support, CRM integration, and advanced analytics together in one platform designed for B2B use cases.

For large corporate event programs at Fortune 500 scale, Cvent remains the most feature-complete option. For public-facing ticketed events, Eventbrite is the simplest path. For dedicated virtual event platform needs, Hopin is worth evaluating. For attendee engagement at professional conferences, Whova leads the category.

Match each platform to your specific use case using the comparison table above. Then shortlist two or three tools for a trial before making a final commitment.

[Start with a Zuddl demo](https://www.zuddl.com) to see how the leading enterprise ${kw} platform fits your events program.
`;

  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
  const kwMatches = (content.match(new RegExp(kw, "gi")) ?? []).length;
  const density = (kwMatches * kw.split(/\s+/).length) / wordCount;

  return {
    title: `10 Best ${kw} in 2025: Compared & Reviewed`,
    metaDescription: `Compare the 10 best ${kw} platforms for 2025. Expert reviews, pricing, and feature breakdowns to help you choose the right tool.`,
    slug: "best-event-management-software",
    content,
    wordCount,
    primaryKwDensity: density,
    jsonLd: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: `10 Best ${kw} in 2025`,
    }),
    ...overrides,
  };
}
