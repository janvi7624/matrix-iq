export interface CameraAccessory {
  name: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
}

export interface CameraProduct {
  modelTag: string;
  category: string;
  description: string;
  distributorPrice: number;
  partnerPrice: number;
  customerPrice: number;
  image: string;
  accessory?: CameraAccessory;
}

// Sourced from AVpricelist.xlsx (Nanta Tech Price List - 2026). Distributor < Partner < Customer price.
export const avCameraProducts: Record<string, CameraProduct> = {
  'NT-4K-CC-8X': {
    modelTag: '4K-CC-8X',
    category: 'Webcam',
    description: 'Video Camera, 4K Business Webcam, USB 3.0,120 degree HFOV, Built in Microphone,  NT-4K-CC-8X',
    distributorPrice: 23700,
    partnerPrice: 26485,
    customerPrice: 30455,
    image: '/av-assets/NT-4K-CC-8X.jpeg'
  },
  'NT-EC-VB360-4K': {
    modelTag: 'EC-VB360-4K',
    category: 'Video Bar',
    description: '4K BYOM 360°, Panoramic Camera, All-In-One Tabletop camera for Huddle Rooms. Four ultra-wide-angle lenses for 360° views, six-array microphones, and full-range speakers, with built-in AI-powered framing and noise cancellation. One-cable USB-C connection, BYOM mode.',
    distributorPrice: 90000,
    partnerPrice: 103500,
    customerPrice: 120000,
    image: '/av-assets/NT-EC-VB360-4K.png'
  },
  'NT-EC-VB-4K': {
    modelTag: 'EC-VB-4K',
    category: 'Video Bar',
    description: 'Conferencing Device (ADPM), 4K Video bar with 6X Digital Zoom Camera with AI tracking Features, NT-EC-VB-4K',
    distributorPrice: 85105,
    partnerPrice: 91800,
    customerPrice: 100980,
    image: '/av-assets/NT-EC-VB-4K.png',
    accessory: {
      name: 'Wireless Dongle for BYOD, Compatible with NT-EC-VB-4K',
      distributorPrice: 6100,
      partnerPrice: 6900,
      customerPrice: 8280
    }
  },
  'NT-M2000S': {
    modelTag: 'M2000S',
    category: 'Video Bar',
    description: 'Conferencing Device (ADPM), 12X optical zoom 4K Dual-Lens Video Bar with AI tracking features, NT-M2000S.',
    distributorPrice: 165751,
    partnerPrice: 185641,
    customerPrice: 213490,
    image: '/av-assets/NT-M2000S.png',
    accessory: {
      name: 'Wireless Dongle for BYOD, Compatible with NT-M2000s',
      distributorPrice: 9100,
      partnerPrice: 10350,
      customerPrice: 12420
    }
  },
  'NT-EC-HD-12X': {
    modelTag: 'EC-HD-12X',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), HD Video Camera with Presenter Tracking, 12X Optical Zoom, HDMI+3G-SDI+RJ45+USB3.0, NT-EC-HD-12X',
    distributorPrice: 69945,
    partnerPrice: 75540,
    customerPrice: 83095,
    image: '/av-assets/NT-EC-HD-12X.png'
  },
  'NT-EC-HD-30X': {
    modelTag: 'EC-HD-30X',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), HD Video Camera with Presenter Tracking, 30X Optical Zoom, HDMI+3G-SDI+RJ45+USB3.0, NT-EC-HD-30X',
    distributorPrice: 79110,
    partnerPrice: 85320,
    customerPrice: 93852,
    image: '/av-assets/NT-EC-HD-30X.png'
  },
  'NT-VX71UVS': {
    modelTag: 'VX71UVS',
    category: 'PTZ',
    description: '4K video conferencing camera, DC 12V/PoE, 1/2.5" CMOS, 8.51MP, 12x optical zoom, 71° HFOV, 4K/30/25 & 1080p/30/25. USB + HDMI + RJ45, line-in, RS232, RS485, gesture control.',
    distributorPrice: 84650,
    partnerPrice: 94805,
    customerPrice: 109025,
    image: '/av-assets/NT-VX71UVS.jpeg'
  },
  'NT-VX630AL': {
    modelTag: 'VX630AL',
    category: 'PTZ',
    description: 'Conferencing Device (ADPM), 4K PTZ camera, 1/1.8" sensor, 4K60, 30x optical zoom, AI tracking, ReID. SDI + HDMI + LAN + USB 2.0, NDI/Dante. Built for large / broadcast rooms.',
    distributorPrice: 127500,
    partnerPrice: 142805,
    customerPrice: 164225,
    image: '/av-assets/NT-VX630AL.png'
  },
  'NT-M702A/C': {
    modelTag: 'M702A/C',
    category: 'Microphone',
    description: 'USB microphone, PoE cascading, black.',
    distributorPrice: 31695,
    partnerPrice: 34230,
    customerPrice: 37651,
    image: '/av-assets/NT-M702AC.png'
  },
  'NT-A10W': {
    modelTag: 'A10W',
    category: 'Mic/Speaker',
    description: 'USB speakerphone with full range speaker and microphone, range up to 10 meters, with wireless dongle connectivity.',
    distributorPrice: 73520,
    partnerPrice: 82345,
    customerPrice: 94695,
    image: '/av-assets/NT-A10W.png'
  }
};
