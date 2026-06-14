/** Core ingestion types. Money is ALWAYS integer paise. No floats cross this boundary. */

export type Institution =
  | "SBI" | "FEDERAL" | "IDFC_BANK" | "IDFC_CC" | "SURYODAY_CC"
  | "HDFC" | "BHIM_UPI" | "ZERODHA" | "UPSTOX";

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

/**
 * Money Manager (.xlsx) household-spending rows are ENRICHMENT ONLY — never create transactions.
 * Her Note/Description is a far richer merchant label than the bank/UPI string; enriching with it
 * lets the existing vendor rules + AI-suggest categorize correctly.
 */
export interface MoneyManagerEntry {
  /** From the `Period` column (Excel serial datetime = log time). Only the DATE part matters for matching. ISO YYYY-MM-DD. */
  loggedAt: string;
  /** Signed paise: + inflow (Income), − outflow (Exp.). */
  amountPaise: number;
  direction: "inflow" | "outflow";
  /** `Category` with the leading emoji stripped + trimmed (e.g. "Transport", "CC", "SIP"). */
  categoryRaw: string;
  /** `Note` column — her label (filled ~100%). */
  note: string | null;
  /** `Description` column — often the real merchant/item (~19% filled). */
  description: string | null;
  /** Best human label for enrichment: `description` when present, else `note`. */
  merchantText: string;
  /** Stable id for idempotency: sha256(period | amountPaise | note | description). */
  rowRef: string;
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
  /** Average buy price in paise, or null when the source has no cost basis (e.g. Upstox holdings). */
  avgPricePaise: number | null;
  lastPricePaise: number;
}

export interface HoldingsSnapshot {
  institution: "ZERODHA" | "UPSTOX";
  accountName: string;
  asOf: string | null; // ISO date if derivable
  rows: HoldingRow[];
  investedPaise: number | null;
  presentPaise: number | null;
  reconciliationOk: boolean;
  warnings: string[];
}

/** One closed (realized) lot from an Upstox tradewise tax report — matched buy↔sell. All money integer paise. */
export interface RealizedLot {
  segment: string;        // "equities" | "fo" | "commodities" | "currencies"
  scrip: string;
  isin: string;
  qty: number;
  buyDate: string;        // ISO
  buyAmtPaise: number;
  sellDate: string;       // ISO
  sellAmtPaise: number;
  totalPlPaise: number;
  shortTermPaise: number;
  longTermPaise: number;
}

/** Per-segment realized P&L + charges summary from an Upstox tax report. */
export interface RealizedSegment {
  segment: string;
  grossPlPaise: number;
  netPlPaise: number;
  chargesPaise: number;
  shortTermPaise: number;
  longTermPaise: number;
  speculationPaise: number;
  lots: RealizedLot[];
}

export interface UpstoxTaxReport {
  financialYear: string;  // e.g. "2526"
  segments: RealizedSegment[];
  reconciliationOk: boolean;
  warnings: string[];
}

/** Upstox dividend events → income transactions, with the stated total for reconciliation. */
export interface UpstoxDividends {
  rows: ParsedTransaction[];
  totalDividendPaise: number;
  reconciliationOk: boolean;
  warnings: string[];
}
