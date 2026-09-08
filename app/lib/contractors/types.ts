export const CONTRACTOR_STATUS_ACTIVE = "ACTIVE";
export const CONTRACTOR_STATUS_DEACTIVATED = "DEACTIVATED";

export type ContractorStatus =
  | typeof CONTRACTOR_STATUS_ACTIVE
  | typeof CONTRACTOR_STATUS_DEACTIVATED;

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

export type ContractorTimeRecord = {
  timeRecordId: string;
  assignmentId: string;
  actualStart: string;
  actualEnd: string;
  unpaidBreakMinutes: number;
  calculatedHours: number;
  status: "Pending Approval" | "Approved" | "Correction Requested";
};
