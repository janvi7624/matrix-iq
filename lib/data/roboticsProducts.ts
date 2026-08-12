export interface RoboticsProduct {
  category: string;
  description: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
  image: string;
}

// Sourced from "2026 Aug_Robot pricing_updated.pdf" (Nanta Robotic Pricing -
// 2026). Distributor < Partner < Customer price (MRP). New models added by
// this update (Go2 series, KeenMow K1) have no /robot-assets/*.png yet — add
// one and set `image` once available; leaving it '' is safe, same as W3.
export const roboticsProducts: Record<string, RoboticsProduct> = {
  T8: {
    category: 'Delivery Robot',
    description: 'Autonomous delivery / serving robot with multi-tier trays and interactive touchscreen face.',
    distributorPrice: 635000,
    partnerPrice: 762000,
    customerPrice: 953000,
    image: '/robot-assets/T8.png'
  },
  T9: {
    category: 'Delivery Robot',
    description: 'Autonomous delivery / serving robot with multi-tier shelves for restaurant and hospitality use.',
    distributorPrice: 668000,
    partnerPrice: 802000,
    customerPrice: 1003000,
    image: '/robot-assets/T9.png'
  },
  T10: {
    category: 'Delivery Robot',
    description: 'Tall-format autonomous delivery robot with large touchscreen display and dual side trays.',
    distributorPrice: 1002000,
    partnerPrice: 1203000,
    customerPrice: 1504000,
    image: '/robot-assets/T10-T11.png'
  },
  T11: {
    category: 'Delivery Robot',
    description: 'Tall-format autonomous delivery robot with large touchscreen display and dual side trays (higher-capacity variant).',
    distributorPrice: 891000,
    partnerPrice: 1070000,
    customerPrice: 1340000,
    image: '/robot-assets/T10-T11.png'
  },
  W3: {
    category: 'Service Robot',
    description: 'Nanta W3 autonomous service robot.',
    distributorPrice: 1075000,
    partnerPrice: 1290000,
    customerPrice: 1613000,
    image: ''
  },
  C30: {
    category: 'Cleaning Robot',
    description: 'Autonomous floor cleaning robot with voice interaction display and dual rotating brushes.',
    distributorPrice: 863500,
    partnerPrice: 1037000,
    customerPrice: 1296000,
    image: '/robot-assets/C30.png'
  },
  C40: {
    category: 'Cleaning Robot',
    description: 'Autonomous commercial floor scrubber robot with side brushes and squeegee.',
    distributorPrice: 1447500,
    partnerPrice: 1738000,
    customerPrice: 2172000,
    image: '/robot-assets/C40.png'
  },
  C55: {
    category: 'Cleaning Robot',
    description: 'Autonomous commercial floor scrubber robot, higher-capacity variant with side brushes and squeegee.',
    distributorPrice: 2182500,
    partnerPrice: 2620000,
    customerPrice: 3274000,
    image: '/robot-assets/C55.png'
  },
  S100: {
    category: 'Transport Robot',
    description: 'Autonomous mobile transport robot (AMR) with flatbed top and touchscreen control panel.',
    distributorPrice: 1002240,
    partnerPrice: 1202688,
    customerPrice: 1503360,
    image: '/robot-assets/S100-S300.png'
  },
  S300: {
    category: 'Transport Robot',
    description: 'Autonomous mobile transport robot (AMR), higher payload variant with flatbed top and touchscreen control panel.',
    distributorPrice: 1113500,
    partnerPrice: 1337000,
    customerPrice: 1671000,
    image: '/robot-assets/S100-S300.png'
  },
  ATV3: {
    category: 'Reception Robot',
    description: 'Autonomous reception / greeting robot with front-facing interactive display.',
    distributorPrice: 802000,
    partnerPrice: 923000,
    customerPrice: 1153000,
    image: '/robot-assets/ATV3.png'
  },
  'AMT 1': {
    category: 'Outdoor Sweeper Robot',
    description: 'Autonomous outdoor sweeping robot with rotating side brushes and beacon light.',
    distributorPrice: 1904000,
    partnerPrice: 2190000,
    customerPrice: 2738000,
    image: '/robot-assets/AMT1.png'
  },
  'Go2 Edu-U1': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot for education and research use, entry configuration.',
    distributorPrice: 992500,
    partnerPrice: 1142000,
    customerPrice: 1427000,
    image: ''
  },
  'Go2 Pro (without controller)': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot, Pro configuration, supplied without a handheld controller.',
    distributorPrice: 539500,
    partnerPrice: 621000,
    customerPrice: 776000,
    image: ''
  },
  'Go2 Pro (with controller)': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot, Pro configuration, supplied with a handheld controller.',
    distributorPrice: 619500,
    partnerPrice: 713000,
    customerPrice: 891000,
    image: ''
  },
  'Go2 X': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot, extended-capability configuration.',
    distributorPrice: 927500,
    partnerPrice: 1067000,
    customerPrice: 1333000,
    image: ''
  },
  'GO2Edu U3': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot for education and research use, U3 configuration.',
    distributorPrice: 1772500,
    partnerPrice: 2039000,
    customerPrice: 2548000,
    image: ''
  },
  'Go2 Edu U4': {
    category: 'Quadruped Robot',
    description: 'Quadruped (four-legged) robot for education and research use, U4 configuration.',
    distributorPrice: 1986000,
    partnerPrice: 2285000,
    customerPrice: 2856000,
    image: ''
  },
  'KeenMow K1': {
    category: 'Robotic Lawn Mower',
    description: 'Autonomous robotic lawn mower for outdoor grounds maintenance.',
    distributorPrice: 163000,
    partnerPrice: 188000,
    customerPrice: 235000,
    image: ''
  }
};
