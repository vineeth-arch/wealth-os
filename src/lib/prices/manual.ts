import { type InstrumentRef, type PriceQuote, type PriceSource } from "./types.js";

/**
 * manual_ibja — unlisted/physical gold anchored to IBJA rates entered by hand. There is nothing to
 * fetch: the price is whatever the user last entered into `prices` with source 'manual_ibja'. The
 * refresh job therefore leaves manual prices untouched (fetchPrice is a no-op returning null).
 */
export const manualSource: PriceSource = {
  id: "manual_ibja",
  kind: "manual",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchPrice(_inst: InstrumentRef): Promise<PriceQuote | null> {
    return null;
  },
};
