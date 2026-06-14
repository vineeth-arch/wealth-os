"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TaxCalculator } from "@/components/tax-calculator";
import { EmergencyFundCalculator } from "@/components/calculators/emergency-fund";

/**
 * Tabbed hub for the India calculators. Each calculator is a self-contained client component; the tax
 * calculator is the original Pass-F view. New calculators are added as tabs as they ship.
 */
export function CalculatorsHub() {
  return (
    <Tabs defaultValue="tax">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="tax">Income tax</TabsTrigger>
        <TabsTrigger value="emergency">Emergency fund</TabsTrigger>
      </TabsList>
      <TabsContent value="tax"><TaxCalculator /></TabsContent>
      <TabsContent value="emergency"><EmergencyFundCalculator /></TabsContent>
    </Tabs>
  );
}
