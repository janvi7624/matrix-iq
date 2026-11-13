import { ProductFeedbackQuestion } from './types';

// Rule-based question suggestions for a Product Manager's feedback form —
// no LLM is wired into this app, so "suggest" means: pick from a curated
// bank keyed by the product's category, plus a couple of questions driven
// by that product's own Pending/Won/Lost numbers (e.g. only ask "why is
// this losing deals" when it actually has lost value). Deterministic and
// free; the PM can still edit/remove every suggestion before saving — this
// is a starting point, not a binding form.

interface UsageSignal {
  pending_value: number;
  won_value: number;
  lost_value: number;
}

const GENERIC_QUESTIONS: Omit<ProductFeedbackQuestion, 'id'>[] = [
  { label: 'How satisfied are clients with this product overall?', type: 'rating' },
  { label: 'Is the current pricing competitive against alternatives clients mention?', type: 'rating' },
  {
    label: 'Where do clients most often hesitate before buying?',
    type: 'choice',
    options: ['Pricing', 'Technical specs', 'Installation/support', 'Delivery timeline', 'Other']
  },
  { label: 'What single feature or change would help close more deals?', type: 'text' }
];

const CATEGORY_QUESTIONS: { match: (category: string) => boolean; questions: Omit<ProductFeedbackQuestion, 'id'>[] }[] = [
  {
    match: (c) => /robot/i.test(c),
    questions: [
      { label: 'How reliable is the robot in real deployments (breakdowns, service calls)?', type: 'rating' },
      { label: 'Which variant/model do clients ask about most?', type: 'text' },
      { label: 'How easy is on-site installation and staff training for clients?', type: 'rating' }
    ]
  },
  {
    match: (c) => /ai analytics|^ai$/i.test(c),
    questions: [
      { label: 'How accurate do clients find the detection/analytics in practice?', type: 'rating' },
      { label: 'Which camera/NVR brand integration is most requested?', type: 'text' },
      { label: 'Do clients find the dashboard/alerts easy to use day-to-day?', type: 'rating' }
    ]
  },
  {
    match: (c) => /visitiq/i.test(c),
    questions: [
      { label: 'How smooth is the visitor onboarding/registration experience?', type: 'rating' },
      { label: 'Do front-desk staff find it easy to use without extra training?', type: 'rating' }
    ]
  },
  {
    match: (c) => /^av$|standee|led|interactive flat panel|conferencing|cable/i.test(c),
    questions: [
      { label: 'How is the installation and after-sales support feedback from clients?', type: 'rating' },
      { label: 'Which room size/configuration do clients ask about most?', type: 'text' }
    ]
  }
];

export function suggestFeedbackQuestions(category: string, usage: UsageSignal): Omit<ProductFeedbackQuestion, 'id'>[] {
  const suggestions: Omit<ProductFeedbackQuestion, 'id'>[] = [...GENERIC_QUESTIONS];

  for (const group of CATEGORY_QUESTIONS) {
    if (group.match(category || '')) suggestions.push(...group.questions);
  }

  if (usage.lost_value > 0) {
    suggestions.push({ label: 'What is the most common reason deals on this product are lost?', type: 'text' });
  }
  if (usage.pending_value > 0) {
    suggestions.push({ label: "What's blocking the pending deals on this product from closing?", type: 'text' });
  }
  if (usage.won_value > 0 && usage.lost_value === 0) {
    suggestions.push({ label: 'What made clients choose this product over alternatives?', type: 'text' });
  }

  return suggestions;
}
