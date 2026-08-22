import { StatusTone } from '@/components/ui/StatusBadge';
import { TravelScheduleStatus } from './types';

export const TRAVEL_STATUS_LABEL: Record<TravelScheduleStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  manager_approved: 'Manager Approved',
  hr_reviewed: 'HR Reviewed',
  admin_approved: 'Admin Approved',
  ticket_booking: 'Ticket Booked',
  hr_final_verification: 'HR Final Verification',
  completed: 'Completed',
  changes_requested: 'Changes Requested'
};

export const TRAVEL_STATUS_TONE: Record<TravelScheduleStatus, StatusTone> = {
  draft: 'pending',
  submitted: 'pending',
  manager_approved: 'confirmed',
  hr_reviewed: 'confirmed',
  admin_approved: 'confirmed',
  ticket_booking: 'confirmed',
  hr_final_verification: 'pending',
  completed: 'done',
  changes_requested: 'rejected'
};

export function travelPendingLabel(status: TravelScheduleStatus): string {
  switch (status) {
    case 'submitted': return 'Awaiting Manager Approval';
    case 'manager_approved': return 'Awaiting HR Review';
    case 'hr_reviewed': return 'Awaiting Admin Approval';
    case 'admin_approved': return 'Awaiting Ticket Booking';
    case 'ticket_booking': return 'Awaiting HR Final Verification';
    default: return TRAVEL_STATUS_LABEL[status];
  }
}
