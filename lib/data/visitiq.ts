// Source: https://vms.nantatech.com/pricing (VisitIQ — Visitor Management
// System). Extracted from the live site's pricing data — plan tiers,
// per-seat/robot/kiosk limits, and add-on rates. Not related to the AI Video
// Analytics (VMS) domain — VisitIQ is a separate visitor-management product.

export interface VisitIqPlan {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  monthlyPrice: number;
  annualPricePerMonth: number; // discounted per-month rate when billed annually (~17% off)
  annualTotal: number;
  robots: number | null; // null = unlimited
  kiosks: number | null;
  employees: number | null;
  admins: string;
  popular?: boolean;
  badge?: string | null;
  features: string[];
}

export const visitIqPlans: VisitIqPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    subtitle: 'Kiosk Only',
    description: 'Small offices & co-working spaces',
    monthlyPrice: 2999,
    annualPricePerMonth: 2499,
    annualTotal: 29990,
    robots: 0,
    kiosks: 1,
    employees: 25,
    admins: '1 admin',
    features: ['OTP-based visitor check-in', 'Walk-in + pre-planned visits', 'Email notifications', 'Basic audit log', 'Visitor history']
  },
  {
    id: 'business',
    name: 'Business',
    subtitle: '1 Robot',
    description: 'Corporate offices, hotels, tech companies',
    monthlyPrice: 6999,
    annualPricePerMonth: 5833,
    annualTotal: 69990,
    robots: 1,
    kiosks: 2,
    employees: 100,
    admins: '3 admins + 5 sub-admins',
    popular: true,
    badge: 'Most Popular',
    features: [
      'Everything in Starter',
      'Temi robot escort & navigation',
      'Service requests (tea/coffee)',
      'Receptionist dashboard',
      'Real-time Socket.IO events',
      'Room / meeting room picker',
      'Basic analytics'
    ]
  },
  {
    id: 'professional',
    name: 'Professional',
    subtitle: 'Up to 3 Robots',
    description: 'Multi-floor campus, hospitals, large corporate',
    monthlyPrice: 14999,
    annualPricePerMonth: 12499,
    annualTotal: 149990,
    robots: 3,
    kiosks: 5,
    employees: 250,
    admins: '10 admins + unlimited sub-admins',
    badge: 'Best Value',
    features: [
      'Everything in Business',
      'Up to 3 Temi robots',
      'Advanced analytics + heatmaps',
      'Multi-branch / multi-floor',
      'Robot battery & path analytics',
      'White-label org branding',
      'Priority support (SLA 4 hr)'
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    subtitle: 'Unlimited',
    description: 'Large enterprise & multi-location deployments',
    monthlyPrice: 29999,
    annualPricePerMonth: 24999,
    annualTotal: 299990,
    robots: null,
    kiosks: null,
    employees: null,
    admins: 'Unlimited',
    features: [
      'Everything in Professional',
      'Unlimited robots & kiosks',
      'Full white-label + custom domain',
      'Custom integrations (MQTT/ROS)',
      'Dedicated server / on-premise',
      'HRMS integration',
      'Dedicated account manager',
      'Custom onboarding session',
      '2 hr SLA guarantee',
      'Custom contract & NDA'
    ]
  }
];

export interface VisitIqAddOn {
  key: string;
  label: string;
  monthlyPrice: number | null; // null = "depends on integration" — quote separately
  oneTime?: boolean;
}

export const visitIqAddOns: VisitIqAddOn[] = [
  { key: 'extraRobot', label: 'Extra Temi Robot', monthlyPrice: 1599 },
  { key: 'extraKiosk', label: 'Extra Kiosk Screen', monthlyPrice: 699 },
  { key: 'extraEmployees25', label: 'Extra 25 Employees', monthlyPrice: 299 },
  { key: 'receptionistModule', label: 'Receptionist Module', monthlyPrice: 1499 },
  { key: 'whiteLabel', label: 'White-Label Branding', monthlyPrice: 4999 },
  { key: 'dedicatedServer', label: 'Dedicated Server', monthlyPrice: 9999 },
  { key: 'oneTimeSetup', label: 'One-Time Setup', monthlyPrice: 9999, oneTime: true },
  { key: 'customIntegration', label: 'Custom Integration', monthlyPrice: null }
];
