/** Shared client/server shapes for the import → review → commit flow. Money is integer paise. */
export interface WireReconciliation {
  openingPaise: number | null;
  closingPaise: number | null;
  expectedDeltaPaise: number | null;
  parsedSumPaise: number;
  ok: boolean;
  detail: string;
}
export interface WireTxn {
  txnDate: string;
  amountPaise: number;
  balanceAfterPaise: number | null;
  descriptionRaw: string;
  refNo: string | null;
  nativeType: string | null;
  subAccount: string | null;
  occurrence: number;
  contentHash: string;
  suggestedCategory: string;
}
export interface WireStatement {
  accountName: string;
  institution: string;
  periodStart: string | null;
  periodEnd: string | null;
  reconciliation: WireReconciliation;
  warnings: string[];
  transactions: WireTxn[];
}
export interface ImportResponse {
  accountId: string;
  accountName: string;
  results: WireStatement[];
}

/** Commit payload — one entry per statement; the server re-derives hashes and re-checks reconciliation. */
export interface CommitRow {
  txnDate: string;
  amountPaise: number;
  balanceAfterPaise: number | null;
  descriptionRaw: string;
  refNo: string | null;
  nativeType: string | null;
  subAccount: string | null;
  categoryName: string;
  tags: string[];
}
export interface CommitStatement {
  periodStart: string | null;
  periodEnd: string | null;
  openingPaise: number | null;
  closingPaise: number | null;
  expectedDeltaPaise: number | null;
  fileName: string;
  institution: string;
  rows: CommitRow[];
}
export interface CommitRequest {
  accountId: string;
  statements: CommitStatement[];
}
