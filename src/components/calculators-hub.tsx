"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaxCalculator } from "@/components/tax-calculator";
import { EmergencyFundCalculator } from "@/components/calculators/emergency-fund";
import { RetirementCalculator } from "@/components/calculators/retirement";
import { HumanLifeValueCalculator } from "@/components/calculators/human-life-value";
import { SipCalculator } from "@/components/calculators/sip";
import { CapitalGainsCalculator, type CgSegmentRow } from "@/components/calculators/capital-gains";

/**
 * Tabbed hub for the India calculators. Each calculator is a self-contained client component; the tax
 * calculator is the original Pass-F view. The capital-gains tab reads the server-fetched realized-gains
 * record (it never recomputes gains).
 */
export function CalculatorsHub({ capitalGainsSegments }: { capitalGainsSegments: CgSegmentRow[] }) {
  return (
    <Tabs defaultValue="tax">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="tax">Income tax</TabsTrigger>
        <TabsTrigger value="emergency">Emergency fund</TabsTrigger>
        <TabsTrigger value="retirement">Retirement / FIRE</TabsTrigger>
        <TabsTrigger value="hlv">Life insurance (HLV)</TabsTrigger>
        <TabsTrigger value="sip">SIP &amp; goals</TabsTrigger>
        <TabsTrigger value="capgains">Capital gains</TabsTrigger>
      </TabsList>
      <TabsContent value="tax"><TaxCalculator /></TabsContent>
      <TabsContent value="emergency"><EmergencyFundCalculator /></TabsContent>
      <TabsContent value="retirement"><RetirementCalculator /></TabsContent>
      <TabsContent value="hlv"><HumanLifeValueCalculator /></TabsContent>
      <TabsContent value="sip"><SipCalculator /></TabsContent>
      <TabsContent value="capgains"><CapitalGainsCalculator segments={capitalGainsSegments} /></TabsContent>
    </Tabs>
  );
}
