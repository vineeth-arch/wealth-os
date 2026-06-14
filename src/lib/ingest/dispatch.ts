import type { StatementParseResult } from "./types.js";
import { parseSbi } from "./parsers/sbi.js";
import { parseFederal } from "./parsers/federal.js";
import { parseIdfcBank } from "./parsers/idfc-bank.js";
import { parseIdfcCc } from "./parsers/idfc-cc.js";
import { parseSuryodayCc } from "./parsers/suryoday-cc.js";
import { parseHdfcBank } from "./parsers/hdfc.js";

/** Institutions that produce transactions from a markdown statement. */
export type TxnInstitution = "SBI" | "FEDERAL" | "IDFC_BANK" | "IDFC_CC" | "SURYODAY_CC" | "HDFC";
const TXN_INSTITUTIONS: TxnInstitution[] = ["SBI", "FEDERAL", "IDFC_BANK", "IDFC_CC", "SURYODAY_CC", "HDFC"];
export function isTxnInstitution(s: string): s is TxnInstitution {
  return (TXN_INSTITUTIONS as string[]).includes(s);
}

/** Normalizes single-statement and multi-statement parsers to a common array shape. */
export function parseStatement(institution: TxnInstitution, content: string): StatementParseResult[] {
  switch (institution) {
    case "SBI": return [parseSbi(content)];
    case "IDFC_BANK": return [parseIdfcBank(content)];
    case "FEDERAL": return parseFederal(content);
    case "IDFC_CC": return parseIdfcCc(content);
    case "SURYODAY_CC": return parseSuryodayCc(content);
    case "HDFC": return [parseHdfcBank(content)];
  }
}
