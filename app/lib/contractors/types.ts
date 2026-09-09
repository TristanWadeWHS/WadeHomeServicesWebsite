export const CONTRACTOR_STATUS_ACTIVE = "ACTIVE";
export const CONTRACTOR_STATUS_DEACTIVATED = "DEACTIVATED";
export const AVAILABILITY_STATUS_ACTIVE = "ACTIVE";
export const AVAILABILITY_STATUS_WITHDRAWN = "WITHDRAWN";
export const AVAILABILITY_TYPE_REGULAR = "REGULAR";
export const AVAILABILITY_TYPE_ON_CALL = "ON_CALL";
export const AVAILABILITY_TYPE_DESIGNATED_SHIFT = "DESIGNATED_SHIFT";
export const AVAILABILITY_TYPE_EXCEPTION = "EXCEPTION";

export type ContractorStatus =
  | typeof CONTRACTOR_STATUS_ACTIVE
  | typeof CONTRACTOR_STATUS_DEACTIVATED;
export type ContractorAvailabilityStatus =
  | typeof AVAILABILITY_STATUS_ACTIVE
  | typeof AVAILABILITY_STATUS_WITHDRAWN;
export type ContractorAvailabilityType =
  | typeof AVAILABILITY_TYPE_REGULAR
  | typeof AVAILABILITY_TYPE_ON_CALL
  | typeof AVAILABILITY_TYPE_DESIGNATED_SHIFT
  | typeof AVAILABILITY_TYPE_EXCEPTION;

export type ContractorAccount = {
  id: string;
  displayName: string;
  email: string;
  status: ContractorStatus;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
};

export type ContractorLeadInput = {
  name: string;
  opportunityInfo: string;
  phone: string;
  email: string;
  streetAddress: string;
  city: string;
  notes: string;
};

export type ContractorSafeAssignment = {
  assignmentId: string;
  leadId: string;
  status: "Confirmed" | "In Progress" | "Completed";
  scheduledStart: string;
  scheduledEnd: string;
  serviceTypes: string;
  city: string;
  accessNotes: string;
};

export type ContractorAvailability = {
  id: string;
  contractorId: string;
  contractorName: string;
  availabilityType: ContractorAvailabilityType;
  dayOfWeek: number | null;
  availabilityDate: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  status: ContractorAvailabilityStatus;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
};

export type ContractorAvailabilityInput = {
  contractorId?: string;
  availabilityType: ContractorAvailabilityType;
  dayOfWeek?: number | null;
  availabilityDate?: string | null;
  startTime: string;
  endTime: string;
  timezone?: string;
  notes?: string;
};

export type ContractorTimeRecord = {
  timeRecordId: string;
  assignmentId: string;
  actualStart: string;
  actualEnd: string;
  unpaidBreakMinutes: number;
  calculatedHours: number;
  status: "Pending Approval" | "Approved" | "Correction Requested";
};
