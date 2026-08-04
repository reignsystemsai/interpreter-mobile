export type PlanId = 'free' | 'pro' | 'unlimited';

export type InterpreterPlan = {
  id: PlanId;
  name: string;
  price: string;
  allowance: string;
  features: string[];
  productId?: string;
};

export const INTERPRETER_PLANS: InterpreterPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    allowance: '3 free Interpreter Minutes every 30 days',
    features: ['Voice calls', 'Video calls', 'Basic AI voices'],
  },
  {
    id: 'pro',
    name: 'Interpreter Pro',
    price: '$9.99/month',
    allowance: '500 interpreted minutes per month',
    productId: 'interpreter_pro_monthly',
    features: [
      '7-day free trial',
      'Faster AI',
      'Premium AI voices',
      'Saved transcripts',
      'Conversation summaries',
      'One-cycle minute rollover',
    ],
  },
  {
    id: 'unlimited',
    name: 'Interpreter Unlimited',
    price: '$19.99/month',
    allowance: '2,000 interpreted minutes per month (fair use)',
    productId: 'interpreter_unlimited_monthly',
    features: [
      '7-day free trial',
      'Everything in Interpreter Pro',
      'Highest priority processing',
      'Advanced AI voices',
      'Group calls',
      'Future premium AI features',
    ],
  },
];
