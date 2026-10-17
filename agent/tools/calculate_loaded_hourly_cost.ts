import { defineTool } from "eve/tools";
import { z } from "zod";
import { eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export default defineTool({
  description:
    "Calculate the Total Cost of Workforce (TCOW) loaded hourly rate for an internal employee or role (factoring in employer payroll taxes/social security, pension match, healthcare, and IT/facilities overhead). Enables managers to budget projects accurately and compare internal FTE hourly costs against external contractor billing rates.",
  inputSchema: z.object({
    employeeId: z.string().optional().describe("Employee ID (e.g. 'EMP-001') if calculating for an existing team member."),
    annualSalary: z.number().optional().describe("Base annual salary if calculating for a hypothetical hire or generic budget."),
    jobLevel: z.string().optional().describe("Job level (e.g. 'IC3', 'IC4', 'M2') to look up default band salary."),
    location: z.string().optional().describe("Location/country, defaults to 'Germany'."),
    projectHours: z.number().optional().describe("Number of project hours to budget (e.g. 300)."),
    contractorHourlyRate: z.number().optional().describe("External contractor billing rate per hour (e.g. 95) for comparison."),
  }),
  async execute({ employeeId, annualSalary, jobLevel, location = "Germany", projectHours, contractorHourlyRate }) {
    let resolvedSalary = annualSalary;
    let currency = "EUR";
    let weeklyHours = 40;
    let roleTitle = "Role";
    let loc = location;

    if (employeeId) {
      const [emp] = await db
        .select()
        .from(schema.hrEmployee)
        .where(eq(schema.hrEmployee.id, employeeId.trim().toUpperCase()))
        .limit(1);

      if (emp) {
        resolvedSalary = emp.annualSalary;
        currency = emp.currency;
        weeklyHours = emp.standardWeeklyHours;
        roleTitle = `${emp.name} (${emp.title})`;
        loc = emp.location;
      }
    } else if (!resolvedSalary && jobLevel) {
      const [band] = await db
        .select()
        .from(schema.hrPayBand)
        .where(eq(schema.hrPayBand.jobLevel, jobLevel.trim().toUpperCase()))
        .limit(1);

      if (band) {
        resolvedSalary = band.midSalary;
        currency = band.currency;
        roleTitle = `${band.jobLevel} ${band.title} (Midpoint)`;
        loc = band.location;
      }
    }

    if (!resolvedSalary) {
      resolvedSalary = 85000;
      roleTitle = "Standard Professional Benchmark";
    }

    const [plan] = await db
      .select()
      .from(schema.hrBenefitPlan)
      .where(ilike(schema.hrBenefitPlan.location, `%${loc}%`))
      .limit(1);

    const annualWorkingHours = weeklyHours * 52;
    const rawHourlyRate = Number((resolvedSalary / annualWorkingHours).toFixed(2));

    // Employer On-costs:
    // 1. Statutory payroll taxes / social contributions
    const onCostPct = plan?.employerOnCostPct ?? 21;
    const statutoryTaxesAnnual = Math.round(resolvedSalary * (onCostPct / 100));

    // 2. Average employer pension contribution (~4.5%)
    const employerPensionAnnual = Math.round(resolvedSalary * 0.045);

    // 3. Benefits (health + wellness)
    const benefitsAnnual = (plan?.standardHealthAnnualValue ?? 3600) + (plan?.wellnessAnnualStipend ?? 1200);

    // 4. Facilities, software licenses & hardware overhead allocation (~8%)
    const facilitiesHardwareAnnual = Math.round(resolvedSalary * 0.08);

    // Total Cost of Workforce (TCOW)
    const totalCostOfWorkforceAnnual =
      resolvedSalary +
      statutoryTaxesAnnual +
      employerPensionAnnual +
      benefitsAnnual +
      facilitiesHardwareAnnual;

    const loadedHourlyRate = Number((totalCostOfWorkforceAnnual / annualWorkingHours).toFixed(2));
    const loadedMultiplier = Number((loadedHourlyRate / rawHourlyRate).toFixed(2));

    let projectComparison = null;
    if (projectHours && projectHours > 0) {
      const internalCost = Math.round(loadedHourlyRate * projectHours);
      let contractorCost = null;
      let costDifference = null;
      let recommendation = null;

      if (contractorHourlyRate && contractorHourlyRate > 0) {
        contractorCost = Math.round(contractorHourlyRate * projectHours);
        const diff = contractorCost - internalCost;
        costDifference = `${diff >= 0 ? "+" : "-"}${currency} ${Math.abs(diff).toLocaleString()}`;

        if (diff > 0) {
          recommendation = `Internal FTE is ${currency} ${diff.toLocaleString()} (${Math.round((diff / contractorCost) * 100)}%) cheaper than the external contractor. Use internal staff if capacity allows.`;
        } else {
          recommendation = `External contractor is ${currency} ${Math.abs(diff).toLocaleString()} cheaper or offers faster ramp-up without permanent overhead.`;
        }
      }

      projectComparison = {
        projectHours,
        internalTotalCost: `${currency} ${internalCost.toLocaleString()}`,
        contractorHourlyRate: contractorHourlyRate ? `${currency} ${contractorHourlyRate}/hr` : undefined,
        contractorTotalCost: contractorCost ? `${currency} ${contractorCost.toLocaleString()}` : undefined,
        variance: costDifference,
        recommendation,
      };
    }

    return {
      role: roleTitle,
      location: loc,
      currency,
      annualWorkingHours,
      breakdown: {
        baseSalary: resolvedSalary,
        rawHourlyRate: `${currency} ${rawHourlyRate}/hr`,
        employerStatutoryTaxes: `${currency} ${statutoryTaxesAnnual.toLocaleString()} (${onCostPct}% social security/payroll tax)`,
        employerPensionMatch: `${currency} ${employerPensionAnnual.toLocaleString()} (avg 4.5% match)`,
        healthAndPerks: `${currency} ${benefitsAnnual.toLocaleString()} (health + wellness)`,
        itAndFacilitiesOverhead: `${currency} ${facilitiesHardwareAnnual.toLocaleString()} (8% equipment & tools)`,
      },
      totalCostOfWorkforce: {
        annualTotal: `${currency} ${totalCostOfWorkforceAnnual.toLocaleString()}`,
        loadedHourlyRate: `${currency} ${loadedHourlyRate}/hr`,
        loadedMultiplier: `${loadedMultiplier}x (True cost vs base pay)`,
        summary: `For every ${currency} 1.00 paid in base salary, the total business cost is ${currency} ${loadedMultiplier}. The true internal cost is ${currency} ${loadedHourlyRate}/hr.`,
      },
      projectComparison,
    };
  },
});
