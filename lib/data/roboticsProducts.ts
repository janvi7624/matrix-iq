export interface RoboticsProduct {
  category: string;
  description: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
  image: string;
}

// Sourced from RobotPricing.xlsx (Robot pricing - 2026). Distributor < Partner < Customer price.
export const roboticsProducts: Record<string, RoboticsProduct> = {
  T8: {
    category: 'Delivery Robot',
    description: 'Autonomous delivery / serving robot with multi-tier trays and interactive touchscreen face.',
    distributorPrice: 644948,
    partnerPrice: 773938,
    customerPrice: 967423,
    image: '/robot-assets/T8.png'
  },
  T9: {
    category: 'Delivery Robot',
    description: 'Autonomous delivery / serving robot with multi-tier shelves for restaurant and hospitality use.',
    distributorPrice: 644948,
    partnerPrice: 773938,
    customerPrice: 967423,
    image: '/robot-assets/T9.png'
  },
  T10: {
    category: 'Delivery Robot',
    description: 'Tall-format autonomous delivery robot with large touchscreen display and dual side trays.',
    distributorPrice: 1002240,
    partnerPrice: 1202688,
    customerPrice: 1503360,
    image: '/robot-assets/T10-T11.png'
  },
  T11: {
    category: 'Delivery Robot',
    description: 'Tall-format autonomous delivery robot with large touchscreen display and dual side trays (higher-capacity variant).',
    distributorPrice: 890880,
    partnerPrice: 1069056,
    customerPrice: 1336320,
    image: '/robot-assets/T10-T11.png'
  },
  W3: {
    category: 'Service Robot',
    description: 'Nanta W3 autonomous service robot.',
    distributorPrice: 1074915,
    partnerPrice: 1289898,
    customerPrice: 1612372,
    image: ''
  },
  C30: {
    category: 'Cleaning Robot',
    description: 'Autonomous floor cleaning robot with voice interaction display and dual rotating brushes.',
    distributorPrice: 863555,
    partnerPrice: 1036266,
    customerPrice: 1295333,
    image: '/robot-assets/C30.png'
  },
  C40: {
    category: 'Cleaning Robot',
    description: 'Autonomous commercial floor scrubber robot with side brushes and squeegee.',
    distributorPrice: 1447680,
    partnerPrice: 1737216,
    customerPrice: 2171520,
    image: '/robot-assets/C40.png'
  },
  C55: {
    category: 'Cleaning Robot',
    description: 'Autonomous commercial floor scrubber robot, higher-capacity variant with side brushes and squeegee.',
    distributorPrice: 2182656,
    partnerPrice: 2619187,
    customerPrice: 3273984,
    image: '/robot-assets/C55.png'
  },
  S100: {
    category: 'Transport Robot',
    description: 'Autonomous mobile transport robot (AMR) with flatbed top and touchscreen control panel.',
    distributorPrice: 1186489,
    partnerPrice: 1423787,
    customerPrice: 1779733,
    image: '/robot-assets/S100-S300.png'
  },
  S300: {
    category: 'Transport Robot',
    description: 'Autonomous mobile transport robot (AMR), higher payload variant with flatbed top and touchscreen control panel.',
    distributorPrice: 1294351,
    partnerPrice: 1553221,
    customerPrice: 1941527,
    image: '/robot-assets/S100-S300.png'
  },
  ATV3: {
    category: 'Reception Robot',
    description: 'Autonomous reception / greeting robot with front-facing interactive display.',
    distributorPrice: 801910,
    partnerPrice: 922197,
    customerPrice: 1152746,
    image: '/robot-assets/ATV3.png'
  },
  'AMT 1': {
    category: 'Outdoor Sweeper Robot',
    description: 'Autonomous outdoor sweeping robot with rotating side brushes and beacon light.',
    distributorPrice: 1904175,
    partnerPrice: 2189801,
    customerPrice: 2737252,
    image: '/robot-assets/AMT1.png'
  }
};
