import { BackOfficeRemarkTag } from './types';

// The fixed example tags from the spec — quick-select chips on the material
// return checklist. 'custom' means "write your own" via the free-text field.
export const BACK_OFFICE_REMARK_LABEL: Record<BackOfficeRemarkTag, string> = {
  good_condition: 'Returned in Good Condition',
  minor_scratch: 'Minor Scratch',
  major_damage: 'Major Damage',
  adapter_missing: 'Adapter Missing',
  power_cable_missing: 'Power Cable Missing',
  wrong_serial_number: 'Wrong Serial Number',
  packing_damaged: 'Packing Damaged',
  custom: 'Other (see remarks)'
};

export const BACK_OFFICE_REMARK_TAGS = Object.keys(BACK_OFFICE_REMARK_LABEL) as BackOfficeRemarkTag[];
