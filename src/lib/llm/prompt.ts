// Pure prompt construction for Gemini category suggestions. NO SDK import → the gate can assert its
// structure under tsx. Hard invariant: only description-level text (description_raw + the enriched
// merchant) and the allowed category names/parents are ever rendered here — never an amount, date,
// balance, account, or ref number.

export interface PromptCategory {
  name: string;
  parent: string | null; // numbered parent bucket, e.g. "03 Spend-it Wants"
}

const FALLBACK = "Uncategorized Review";

/**
 * India-specific worked examples: an enriched "narration · merchant" string → the correct leaf.
 * Synthetic only (no real amounts/dates/PII); the ref numbers are placeholders that mirror the UPI
 * narration shape. These teach bucket-first reasoning and the common Indian vendors.
 */
const FEW_SHOT: ReadonlyArray<readonly [string, string]> = [
  ["UPI/DR/412345678901/SWIGGY/HDFC/swiggy@axisbank · Swiggy", "Food Delivery"],
  ["UPI/DR/512282836511/ZOMATO/ICIC/zomato@hdfcbank · Zomato", "Food Delivery"],
  ["UPI/DR/512282836511/LAZYPAY/AIRP/lazypay@icici · LazyPay", "BNPL Payment"],
  ["UPI/DR/612345678901/CRED/AXIS/cred.club@axisb · CRED", "Credit Card Payment"],
  ["UPI/DR/712345678901/INDIANOIL/HDFC/indianoil@ybl · Indian Oil", "Fuel"],
  ["POS/HPCL PETROL PUMP/MUMBAI · HP Petrol Pump", "Fuel"],
  ["NEFT/CR/ACME TECHNOLOGIES PVT LTD/SALARY · Acme Technologies", "Salary"],
  ["UPI/CR/812345678901/clientco@okhdfcbank · Designworks Studio", "Freelance Income"],
  ["UPI/DR/912345678901/BIGBASKET/ICIC/bigbasket@ybl · BigBasket", "Groceries"],
  ["UPI/DR/112345678901/9876500000@ybl · 9876500000", "Uncategorized Review"],
];

/** The EXACT prompt sent to the model. Pure → inspectable, returnable for audit, gate-testable. */
export function buildSuggestPrompt(descriptions: string[], categories: PromptCategory[]): string {
  // Group leaves under their numbered parent bucket so the model reasons bucket-first (261 flat leaves
  // are too many; the structure materially improves accuracy).
  const byParent = new Map<string, string[]>();
  for (const c of categories) {
    const g = c.parent ?? "—";
    const arr = byParent.get(g);
    if (arr) arr.push(c.name); else byParent.set(g, [c.name]);
  }
  const grouped = [...byParent.entries()]
    .sort((a, b) => a[0].localeCompare(b[0])) // numbered prefixes sort 01…15 naturally
    .map(([parent, leaves]) =>
      [`${parent}:`, ...leaves.sort((x, y) => x.localeCompare(y)).map((n) => `  - ${n}`)].join("\n"))
    .join("\n");

  return [
    "You categorize Indian bank and credit-card transaction descriptions into a fixed taxonomy.",
    'A description may include a "·" followed by the real counterparty/merchant name — treat it as the strongest signal.',
    "",
    "Reason bucket-first: pick the correct parent bucket, then the single best leaf category inside it.",
    `Use the category NAME verbatim from the allowed list. If you are not confident which leaf fits, use "${FALLBACK}" rather than guessing.`,
    "",
    "Allowed categories, grouped by parent bucket:",
    grouped,
    "",
    "Examples:",
    FEW_SHOT.map(([d, c]) => `- "${d}" → ${c}`).join("\n"),
    "",
    "Return one object per description, echoing its index. Use only names from the allowed list, verbatim.",
    "",
    "Descriptions:",
    descriptions.map((d, i) => `${i}. ${d}`).join("\n"),
  ].join("\n");
}
