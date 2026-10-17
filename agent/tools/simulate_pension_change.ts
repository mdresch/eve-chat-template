import { defineTool } from "eve/tools";
import { z } from "zod";
import { eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export default defineTool({
  description:
    "Simulate the financial impact of changing an employee's pension contribution percentage. Shows employer matching captured ('free company money'), estimated net take-home impact after tax relief, and long-term 5- and 10-year compounding growth.",
  inputSchema: z.object({
    employeeQuery: z.string().min(1).describe("Employee ID (e.g. EMP-001) or employee name."),
    newContributionPct: z
      .number()
      .min(0)
      .max(25)
      .describe("The new proposed employee voluntary contribution percentage (e.g. 6 for 6%)."),
  }),
  async execute({ employeeQuery, newContributionPct }) {
    const trimmed = employeeQuery.trim();

    const employees = await db
      .select()
      .from(schema.hrEmployee)
      .where(
        or(
          eq(schema.hrEmployee.id, trimmed.toUpperCase()),
          ilike(schema.hrEmployee.name, `%${trimmed}%`),
        ),
      )
      .limit(1);

    if (employees.length === 0) {
      return {
        success: false,
        message: `Employee "${employeeQuery}" not found.`,
      };
    }

    const emp = employees[0];

    const [plan] = await db
      .select()
      .from(schema.hrBenefitPlan)
      .where(eq(schema.hrBenefitPlan.location, emp.location))
      .limit(1);

    const tier1Cap = plan ? plan.tier1EmployeeCapPct : 4;
    const tier1Rate = plan ? plan.tier1EmployerMatchRatePct / 100 : 1.0;
    const tier2Cap = plan ? plan.tier2EmployeeCapPct : 6;
    const tier2Rate = plan ? plan.tier2EmployerMatchRatePct / 100 : 0.5;
    const maxEmployerPct = plan ? plan.maxEmployerPensionMatchPct : 5;

    function calculateEmployerMatch(pct: number) {
      const tier1 = Math.min(pct, tier1Cap) * tier1Rate;
      const tier2 = Math.min(Math.max(pct - tier1Cap, 0), tier2Cap - tier1Cap) * tier2Rate;
      return Math.min(tier1 + tier2, maxEmployerPct);
    }

    const currentEmpPct = emp.pensionContributionPct;
    const currentEmployerPct = calculateEmployerMatch(currentEmpPct);
    const newEmployerPct = calculateEmployerMatch(newContributionPct);

    const salary = emp.annualSalary;
    const currentEmpAnnual = Math.round(salary * (currentEmpPct / 100));
    const currentEmployerAnnual = Math.round(salary * (currentEmployerPct / 100));
    const currentTotalAnnual = currentEmpAnnual + currentEmployerAnnual;

    const newEmpAnnual = Math.round(salary * (newContributionPct / 100));
    const newEmployerAnnual = Math.round(salary * (newEmployerPct / 100));
    const newTotalAnnual = newEmpAnnual + newEmployerAnnual;

    // Monthly figures
    const currentMonthlyDeposit = Math.round(currentTotalAnnual / 12);
    const newMonthlyDeposit = Math.round(newTotalAnnual / 12);
    const monthlyDepositDelta = newMonthlyDeposit - currentMonthlyDeposit;

    // Estimated tax relief (assumed ~38% marginal tax + social deduction advantage on pre-tax pension contributions)
    const ESTIMATED_TAX_RELIEF_RATE = 0.38;
    const grossMonthlyEmpDelta = (newEmpAnnual - currentEmpAnnual) / 12;
    const estimatedNetMonthlyCost = Math.round(grossMonthlyEmpDelta * (1 - ESTIMATED_TAX_RELIEF_RATE));
    const additionalEmployerMatchMonthly = Math.round((newEmployerAnnual - currentEmployerAnnual) / 12);

    // Compound future value calculation (FV = P * [((1 + r)^n - 1) / r])
    // Assuming 6% average annual market return
    function projectSavings(annualContribution: number, years: number, r = 0.06) {
      return Math.round(annualContribution * (((1 + r) ** years - 1) / r));
    }

    const proj5YearsCurrent = projectSavings(currentTotalAnnual, 5);
    const proj5YearsNew = projectSavings(newTotalAnnual, 5);
    const proj10YearsCurrent = projectSavings(currentTotalAnnual, 10);
    const proj10YearsNew = projectSavings(newTotalAnnual, 10);

    return {
      success: true,
      employee: {
        id: emp.id,
        name: emp.name,
        salary: `${emp.currency} ${salary.toLocaleString()}`,
        location: emp.location,
      },
      comparison: {
        currentRate: {
          employeePct: `${currentEmpPct}%`,
          employerMatchPct: `${currentEmployerPct}%`,
          employeeMonthlyCostGross: `${emp.currency} ${Math.round(currentEmpAnnual / 12).toLocaleString()}`,
          employerMonthlyMatch: `${emp.currency} ${Math.round(currentEmployerAnnual / 12).toLocaleString()}`,
          totalMonthlyDeposit: `${emp.currency} ${currentMonthlyDeposit.toLocaleString()}`,
          totalAnnualDeposit: `${emp.currency} ${currentTotalAnnual.toLocaleString()}`,
        },
        proposedRate: {
          employeePct: `${newContributionPct}%`,
          employerMatchPct: `${newEmployerPct}%`,
          employeeMonthlyCostGross: `${emp.currency} ${Math.round(newEmpAnnual / 12).toLocaleString()}`,
          employerMonthlyMatch: `${emp.currency} ${Math.round(newEmployerAnnual / 12).toLocaleString()}`,
          totalMonthlyDeposit: `${emp.currency} ${newMonthlyDeposit.toLocaleString()}`,
          totalAnnualDeposit: `${emp.currency} ${newTotalAnnual.toLocaleString()}`,
        },
        netTakeHomeImpact: {
          grossMonthlySalarySacrifice: `${emp.currency} ${Math.round(grossMonthlyEmpDelta).toLocaleString()}`,
          estimatedNetTakeHomeReduction: `${emp.currency} ${Math.abs(estimatedNetMonthlyCost).toLocaleString()} / month (after tax relief)`,
          freeCompanyMatchGain: `${emp.currency} ${additionalEmployerMatchMonthly.toLocaleString()} / month (${emp.currency} ${(newEmployerAnnual - currentEmployerAnnual).toLocaleString()} / year)`,
          immediateReturnOnInvestment: grossMonthlyEmpDelta > 0 
            ? `${Math.round((additionalEmployerMatchMonthly / estimatedNetMonthlyCost) * 100)}% instant return via employer match & tax relief`
            : "N/A",
        },
        futureWealthProjection: {
          assumedAnnualGrowth: "6.0% nominal return",
          in5Years: {
            currentAccumulation: `${emp.currency} ${proj5YearsCurrent.toLocaleString()}`,
            proposedAccumulation: `${emp.currency} ${proj5YearsNew.toLocaleString()}`,
            extraWealthCreated: `+${emp.currency} ${(proj5YearsNew - proj5YearsCurrent).toLocaleString()}`,
          },
          in10Years: {
            currentAccumulation: `${emp.currency} ${proj10YearsCurrent.toLocaleString()}`,
            proposedAccumulation: `${emp.currency} ${proj10YearsNew.toLocaleString()}`,
            extraWealthCreated: `+${emp.currency} ${(proj10YearsNew - proj10YearsCurrent).toLocaleString()}`,
          },
        },
      },
    };
  },
});
