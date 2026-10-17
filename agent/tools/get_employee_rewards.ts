import { defineTool } from "eve/tools";
import { z } from "zod";
import { ilike, or, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export default defineTool({
  description:
    "Retrieve an employee's total rewards package, including base salary, standard hourly rate, employer pension match, health/wellness benefits, target bonus, and the True Hourly Value (total rewards per working hour).",
  inputSchema: z.object({
    employeeQuery: z
      .string()
      .min(1)
      .describe("Employee ID (e.g. EMP-001), full/partial name (e.g. 'Sarah Jenkins' or 'Liam'), or internal email."),
  }),
  async execute({ employeeQuery }) {
    const trimmed = employeeQuery.trim();

    // Query employee by ID, name, or email
    const employees = await db
      .select()
      .from(schema.hrEmployee)
      .where(
        or(
          eq(schema.hrEmployee.id, trimmed.toUpperCase()),
          ilike(schema.hrEmployee.name, `%${trimmed}%`),
          ilike(schema.hrEmployee.email, `%${trimmed}%`),
        ),
      )
      .limit(5);

    if (employees.length === 0) {
      const allEmployees = await db
        .select({
          id: schema.hrEmployee.id,
          name: schema.hrEmployee.name,
          title: schema.hrEmployee.title,
          department: schema.hrEmployee.department,
          location: schema.hrEmployee.location,
        })
        .from(schema.hrEmployee)
        .limit(10);

      return {
        found: false,
        message: `No employee found matching "${employeeQuery}".`,
        availableEmployees: allEmployees,
      };
    }

    const employee = employees[0];

    // Fetch corresponding benefit plan for location
    const [plan] = await db
      .select()
      .from(schema.hrBenefitPlan)
      .where(eq(schema.hrBenefitPlan.location, employee.location))
      .limit(1);

    const standardWeeklyHours = employee.standardWeeklyHours || 40;
    const annualWorkingHours = standardWeeklyHours * 52;
    const baseHourlyRate = Number((employee.annualSalary / annualWorkingHours).toFixed(2));

    // Calculate employer pension match
    // Plan: Tier 1 (100% match up to 4%), Tier 2 (50% match between 4% and 6%), capped at 5%
    const tier1Cap = plan ? plan.tier1EmployeeCapPct : 4;
    const tier1Rate = plan ? plan.tier1EmployerMatchRatePct / 100 : 1.0;
    const tier2Cap = plan ? plan.tier2EmployeeCapPct : 6;
    const tier2Rate = plan ? plan.tier2EmployerMatchRatePct / 100 : 0.5;
    const maxEmployerPct = plan ? plan.maxEmployerPensionMatchPct : 5;

    const empContribPct = employee.pensionContributionPct;
    const tier1MatchedPct = Math.min(empContribPct, tier1Cap) * tier1Rate;
    const tier2MatchedPct = Math.min(Math.max(empContribPct - tier1Cap, 0), tier2Cap - tier1Cap) * tier2Rate;
    const totalEmployerMatchPct = Math.min(tier1MatchedPct + tier2MatchedPct, maxEmployerPct);

    const employeeAnnualPensionContrib = Math.round(employee.annualSalary * (empContribPct / 100));
    const employerAnnualPensionContrib = Math.round(employee.annualSalary * (totalEmployerMatchPct / 100));

    // Health & Perks
    const healthAnnualValue =
      employee.healthTier === "premium"
        ? (plan?.premiumHealthAnnualValue ?? 6200)
        : (plan?.standardHealthAnnualValue ?? 3600);
    const wellnessAnnualValue = plan?.wellnessAnnualStipend ?? 1200;

    // Bonus Target
    const bonusTargetAmount = Math.round(employee.annualSalary * (employee.bonusTargetPct / 100));

    // Total Rewards Calculation
    const totalAnnualRewards =
      employee.annualSalary +
      employerAnnualPensionContrib +
      healthAnnualValue +
      wellnessAnnualValue +
      bonusTargetAmount;

    const trueHourlyValue = Number((totalAnnualRewards / annualWorkingHours).toFixed(2));
    const hourlyUplift = Number((trueHourlyValue - baseHourlyRate).toFixed(2));
    const benefitsUpliftPct = Number((((totalAnnualRewards - employee.annualSalary) / employee.annualSalary) * 100).toFixed(1));

    return {
      found: true,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        title: employee.title,
        department: employee.department,
        jobLevel: employee.jobLevel,
        location: employee.location,
        hireDate: employee.hireDate,
        currency: employee.currency,
        standardWeeklyHours,
        annualWorkingHours,
      },
      compensation: {
        baseSalary: employee.annualSalary,
        baseHourlyRate,
        monthlyBaseSalary: Number((employee.annualSalary / 12).toFixed(2)),
      },
      benefitsBreakdown: {
        pension: {
          employeeContributionPct: empContribPct,
          employeeAnnualContribution: employeeAnnualPensionContrib,
          employeeMonthlyContribution: Math.round(employeeAnnualPensionContrib / 12),
          employerMatchPct: totalEmployerMatchPct,
          employerAnnualContribution: employerAnnualPensionContrib,
          employerMonthlyContribution: Math.round(employerAnnualPensionContrib / 12),
          matchEfficiency: empContribPct > 0 ? `${(totalEmployerMatchPct / empContribPct * 100).toFixed(0)}% company matched` : "None",
        },
        healthInsurance: {
          tier: employee.healthTier,
          annualValue: healthAnnualValue,
          monthlyValue: Math.round(healthAnnualValue / 12),
        },
        wellnessStipend: {
          annualValue: wellnessAnnualValue,
          monthlyValue: Math.round(wellnessAnnualValue / 12),
        },
        performanceBonus: {
          targetPct: employee.bonusTargetPct,
          annualTargetAmount: bonusTargetAmount,
        },
      },
      totalRewards: {
        totalAnnualRewards,
        trueHourlyValue,
        hourlyUplift,
        benefitsUpliftPct,
        summary: `Gross base is ${employee.currency} ${employee.annualSalary.toLocaleString()} (${employee.currency} ${baseHourlyRate}/hr), but total rewards value is ${employee.currency} ${totalAnnualRewards.toLocaleString()} (${employee.currency} ${trueHourlyValue}/hr, a +${benefitsUpliftPct}% package uplift).`,
      },
    };
  },
});
