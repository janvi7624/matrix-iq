export interface AiAnalyticsFeature {
  category: string;
  name: string;
  tiers: [number, number, number, number, number];
  desc: string;
}

// Tier prices are [1-25, 26-60, 61-100, 101-500, 500+] cameras, in Rs per camera per year.
export const aiAnalytics: AiAnalyticsFeature[] = [
  { category: 'Basic', name: 'People Count', tiers: [7000, 6300, 5600, 4900, 4200], desc: 'Counts the number of people entering, exiting, or present in an area.' },
  { category: 'Basic', name: 'Crowd Count', tiers: [8000, 7200, 6400, 5600, 4800], desc: 'Estimates crowd density and monitors overcrowding situations.' },
  { category: 'Basic', name: 'Person Tracking', tiers: [9000, 8100, 7200, 6300, 5400], desc: "Tracks a person's movement across one or multiple camera views." },
  { category: 'Basic', name: 'Object Detection', tiers: [7000, 6300, 5600, 4900, 4200], desc: 'Detects and identifies predefined objects in the camera view.' },
  { category: 'Basic', name: 'Vehicle Count', tiers: [7000, 6300, 5600, 4900, 4200], desc: 'Counts vehicles entering, exiting, or passing through a location.' },
  { category: 'Basic', name: 'Camera Tampering', tiers: [6000, 5400, 4800, 4200, 3600], desc: 'Detects camera obstruction, movement, defocus, or tampering attempts.' },
  { category: 'Basic', name: 'Footfall Analytics', tiers: [7500, 6750, 6000, 5250, 4500], desc: 'Measures visitor traffic patterns and peak activity periods.' },
  { category: 'Security', name: 'Intrusion Detection', tiers: [12000, 10800, 9600, 8400, 7200], desc: 'Detects unauthorized entry into restricted or protected zones.' },
  { category: 'Security', name: 'Loitering Detection', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Identifies individuals staying in a designated area longer than allowed.' },
  { category: 'Security', name: 'Unattended Object', tiers: [11000, 9900, 8800, 7700, 6600], desc: 'Detects bags, packages, or objects left unattended for a specified time.' },
  { category: 'Security', name: 'Person Collapse', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects a person falling, collapsing, or remaining motionless on the ground.' },
  { category: 'Security', name: 'Fight Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Identifies physical altercations and aggressive human behavior.' },
  { category: 'Security', name: 'Theft Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Detects suspicious object removal or potential theft activities.' },
  { category: 'Security', name: 'Violence Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Recognizes violent actions and abnormal aggressive behavior.' },
  { category: 'Security', name: 'Weapon Detection', tiers: [28000, 25200, 22400, 19600, 16800], desc: 'Detects visible weapons such as guns, knives, or other dangerous objects.' },
  { category: 'Security', name: 'Riot Detection', tiers: [30000, 27000, 24000, 21000, 18000], desc: 'Identifies crowd aggression, unrest, and large-scale disturbances.' },
  { category: 'Security', name: 'Stone Pelting', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Detects stone-throwing or projectile-based violent activities.' },
  { category: 'Face', name: 'Face Recognition', tiers: [25000, 22500, 20000, 17500, 15000], desc: 'Identifies and matches faces against registered databases or watchlists.' },
  { category: 'Face', name: 'Face Search', tiers: [18000, 16200, 14400, 12600, 10800], desc: 'Searches and locates specific individuals from recorded video footage.' },
  { category: 'Face', name: 'Searchable Attributes', tiers: [15000, 13500, 12000, 10500, 9000], desc: 'Searches people using attributes such as age, gender, clothing, or accessories.' },
  { category: 'Face', name: 'No Face Mask', tiers: [6000, 5400, 4800, 4200, 3600], desc: 'Detects individuals not wearing face masks in monitored areas.' },
  { category: 'Face', name: 'Emotion Detection', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Analyzes facial expressions to identify emotional states.' },
  { category: 'Vehicle', name: 'ANPR', tiers: [24000, 21600, 19200, 16800, 14400], desc: 'Automatically captures and recognizes vehicle license plate numbers.' },
  { category: 'Vehicle', name: 'Vehicle Make/Model', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Identifies vehicle make, model, and color information.' },
  { category: 'Vehicle', name: 'Speed Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Estimates and monitors vehicle speed in real time.' },
  { category: 'Vehicle', name: 'Wrong Parking', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects vehicles parked in unauthorized or restricted locations.' },
  { category: 'Vehicle', name: 'No Helmet', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects two-wheeler riders not wearing helmets.' },
  { category: 'Vehicle', name: 'Triple Rider', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects more than two riders on a two-wheeler.' },
  { category: 'Vehicle', name: 'No Seatbelt', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects drivers or passengers not wearing seatbelts.' },
  { category: 'Vehicle', name: 'Mobile While Driving', tiers: [15000, 13500, 12000, 10500, 9000], desc: 'Detects drivers using mobile phones while driving.' },
  { category: 'Vehicle', name: 'RLVD', tiers: [22000, 19800, 17600, 15400, 13200], desc: 'Detects vehicles violating red traffic signals.' },
  { category: 'Vehicle', name: 'Parking Management', tiers: [22000, 19800, 17600, 15400, 13200], desc: 'Monitors parking occupancy and available parking spaces.' },
  { category: 'Vehicle', name: 'Congestion Detection', tiers: [14000, 12600, 11200, 9800, 8400], desc: 'Detects traffic congestion and abnormal vehicle density.' },
  { category: 'Industrial / Safety', name: 'Fire & Smoke', tiers: [24000, 21600, 19200, 16800, 14400], desc: 'Detects early signs of fire and smoke for rapid response.' },
  { category: 'Industrial / Safety', name: 'PPE Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Detects whether workers are wearing required safety equipment such as helmets, vests, and gloves.' },
  { category: 'Industrial / Safety', name: 'Vandalism Detection', tiers: [15000, 13500, 12000, 10500, 9000], desc: 'Detects deliberate damage or destruction of property and assets.' },
  { category: 'Industrial / Safety', name: 'Garbage Detection', tiers: [10000, 9000, 8000, 7000, 6000], desc: 'Identifies garbage accumulation in unauthorized locations.' },
  { category: 'Industrial / Safety', name: 'Inventory Detection', tiers: [13000, 11700, 10400, 9100, 7800], desc: 'Monitors stock levels and detects missing or low inventory.' },
  { category: 'Industrial / Safety', name: 'Customer Footfall & Dwell Time', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Measures customer visits and the time spent in specific areas.' },
  { category: 'Industrial / Safety', name: 'Person Gaze to Advertisement', tiers: [10000, 9000, 8000, 7000, 6000], desc: 'Measures customer attention toward advertisements or displays.' },
  { category: 'Industrial / Safety', name: 'Proximity to Advertisement', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Tracks how closely customers approach promotional displays.' },
  { category: 'Industrial / Safety', name: 'Accident Detection', tiers: [18000, 16200, 14400, 12600, 10800], desc: 'Detects vehicle collisions and road accidents in real time.' },
  { category: 'Industrial / Safety', name: 'Social Distancing', tiers: [6000, 5400, 4800, 4200, 3600], desc: 'Monitors and measures compliance with social distancing guidelines.' },
  { category: 'Industrial / Safety', name: 'Lone Woman Detection', tiers: [16000, 14400, 12800, 11200, 9600], desc: 'Identifies a woman alone in a monitored area for enhanced safety monitoring.' },
  { category: 'Industrial / Safety', name: 'Woman Surrounded By Men', tiers: [18000, 16200, 14400, 12600, 10800], desc: 'Detects situations where a woman is surrounded by multiple individuals.' },
  { category: 'Industrial / Safety', name: 'Human/Animal/Vehicle Classification', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Classifies detected objects as humans, animals, or vehicles.' },
  { category: 'Industrial / Safety', name: 'Graffiti Detection', tiers: [13000, 11700, 10400, 9100, 7800], desc: 'Detects unauthorized writing, painting, or markings on property.' },
  { category: 'Industrial / Safety', name: 'Person Climbing Barricade', tiers: [11000, 9900, 8800, 7700, 6600], desc: 'Detects individuals attempting to cross fences, walls, or barricades.' },
  { category: 'Industrial / Safety', name: 'Person Waving', tiers: [9000, 8100, 7200, 6300, 5400], desc: 'Detects waving gestures that may indicate requests for attention or assistance.' }
];

export const AI_SLAB_LABELS = ['1–25 Cameras', '26–60 Cameras', '61–100 Cameras', '101–500 Cameras', '500+ Cameras'];

export function getAiSlabIndex(cameraCount: number): number {
  if (cameraCount <= 25) return 0;
  if (cameraCount <= 60) return 1;
  if (cameraCount <= 100) return 2;
  if (cameraCount <= 500) return 3;
  return 4;
}
