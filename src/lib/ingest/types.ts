/** Core ingestion types. Money is ALWAYS integer paise. No floats cross this boundary. */

export type Institution =
  | "SBI" | "FEDERAL" | "IDFC_BANK" | "IDFC_CC" | "SURYODAY_CC"
  | "BHIM_UPI" | "ZERODHA";

export interface ParsedTransaction {
  /** ISO YYYY-MM-DD */
  txnDate: string;
  /** Raw narration exactly as stitched from the statement (whitespace-normalized). */
  descriptionRaw: string;
  /** Signed paise. + = inflow to this account, − = outflow. CC purchase = −, CC bill payment received = +. */
  amountPaise: number;
  /** Running balance after txn, signed paise, when the statement provides it. */
  balanceAfterPaise?: number;
  /** Bank reference / ref no when present. */
  refNo?: string;
  /** Statement-native type marker (PURCHASE, PAYMENT, GST, ...) when present. */
  nativeType?: string;
  /** e.g. card last-4 for multi-card CC statements. */
  subAccount?: string;
  /** Occurrence index among identical (date,amount,desc) within one statement period — keeps genuine repeats, kills re-imports. */
  occurrence: number;
  /** sha256 dedup key. */
  contentHash: string;
}

export interface Reconciliation {
  openingPaise: number | null;
  closingPaise: number | null;
  /** closing − opening as stated by the statement itself. */
  expectedDeltaPaise: number | null;
  /** sum of parsed signed amounts. */
  parsedSumPaise: number;
  ok: boolean;
  detail: string;
}

export interface StatementParseResult {
  institution: Institution;
  accountName: string;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: ParsedTransaction[];
  reconciliation: Reconciliation;
  warnings: string[];
}

/** BHIM/UPI rows are ENRICHMENT ONLY — never create transactions. */
export interface UpiEnrichmentRow {
  txnDate: string;
  amountPaise: number; // signed, same convention
  bankName: string;
  accountMask: string;
  counterpartyVpa: string;
  counterpartyName: string;
  refNo: string;
  status: string;
}

export interface HoldingRow {
  symbol: string;
  isin: string;
  assetClass: "equity" | "mutual_fund";
  sectorOrType: string;
  qty: number;            // units can be fractional for MF
  avgPricePaise: number;
  lastPricePaise: number;
}

export interface HoldingsSnapshot {
  institution: "ZERODHA";
  accountName: string;
  asOf: string | null; // ISO date if derivable
  rows: HoldingRow[];
  investedPaise: number | null;
  presentPaise: number | null;
  reconciliationOk: boolean;
  warnings: string[];
}
