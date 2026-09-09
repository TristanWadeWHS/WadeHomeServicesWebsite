export const CONTRACTOR_STATUS_ACTIVE = "ACTIVE";
export const CONTRACTOR_STATUS_DEACTIVATED = "DEACTIVATED";
export const AVAILABILITY_STATUS_ACTIVE = "ACTIVE";
export const AVAILABILITY_STATUS_WITHDRAWN = "WITHDRAWN";
export const AVAILABILITY_TYPE_REGULAR = "REGULAR";
export const AVAILABILITY_TYPE_ON_CALL = "ON_CALL";
export const AVAILABILITY_TYPE_DESIGNATED_SHIFT = "DESIGNATED_SHIFT";
export const AVAILABILITY_TYPE_EXCEPTION = "EXCEPTION";
export const ASSIGNMENT_STATUS_PROPOSED = "PROPOSED";
export const ASSIGNMENT_STATUS_APPROVED = "APPROVED";
export const ASSIGNMENT_STATUS_REJECTED = "REJECTED";
export const ASSIGNMENT_STATUS_CANCELED = "CANCELED";
export const ASSIGNMENT_STATUS_CONFLICT_REVIEW = "CONFLICT_REVIEW";

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
export type ContractorAssignmentStatus =
  | typeof ASSIGNMENT_STATUS_PROPOSED
  | typeof ASSIGNMENT_STATUS_APPROVED
  | typeof ASSIGNMENT_STATUS_REJECTED
  | typeof ASSIGNMENT_STATUS_CANCELED
  | typeof ASSIGNMENT_STATUS_CONFLICT_REVIEW;

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
  status: ContractorAssignmentStatus;
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

export type ContractorAssignment = ContractorSafeAssignment & {
  contractorId: string;
  contractorName: string;
  jobName: string;
  requiredCrewSize: number;
  travelBufferMinutes: number;
  travelBufferOverride: boolean;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string;
  approvedAt: string | null;
  rejectedBy: string;
  rejectedAt: string | null;
  canceledBy: string;
  canceledAt: string | null;
  conflictFlaggedAt: string | null;
  conflictReason: string;
  auditTrail: string;
  updatedAt: string;
};

export type AssignmentCandidate = {
  contractorId: string;
  contractorName: string;
  availabilityType: ContractorAvailabilityType | "NONE";
  available: boolean;
  onCall: boolean;
  conflict: boolean;
  conflictReason: string;
};

export type AssignmentProposalInput = {
  leadId: string;
  jobName: string;
  scheduledStart: string;
  scheduledEnd: string;
  serviceTypes: string;
  city: string;
  accessNotes: string;
  requiredCrewSize: number;
  contractorIds: string[];
  travelBufferMinutes?: number;
  travelBufferOverride?: boolean;
  note?: string;
};
