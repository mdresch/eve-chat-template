import { existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
} else if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = drizzle({ client: neon(url), schema });

async function seed() {
  console.log("Seeding HR Benefit Plans...");
  await db
    .insert(schema.hrBenefitPlan)
    .values([
      {
        id: "PLAN-DE-2026",
        location: "Germany",
        currency: "EUR",
        tier1EmployeeCapPct: 4,
        tier1EmployerMatchRatePct: 100, // 100% match up to 4%
        tier2EmployeeCapPct: 6,
        tier2EmployerMatchRatePct: 50, // 50% match between 4% and 6% (max match 5%)
        maxEmployerPensionMatchPct: 5,
        standardHealthAnnualValue: 3600,
        premiumHealthAnnualValue: 6200,
        wellnessAnnualStipend: 1200,
        employerOnCostPct: 21, // ~21% German employer social security contributions
      },
      {
        id: "PLAN-UK-2026",
        location: "United Kingdom",
        currency: "GBP",
        tier1EmployeeCapPct: 5,
        tier1EmployerMatchRatePct: 100,
        tier2EmployeeCapPct: 8,
        tier2EmployerMatchRatePct: 50,
        maxEmployerPensionMatchPct: 6,
        standardHealthAnnualValue: 2400,
        premiumHealthAnnualValue: 4800,
        wellnessAnnualStipend: 1000,
        employerOnCostPct: 14, // ~13.8% UK Employer National Insurance + apprenticeship levy
      },
      {
        id: "PLAN-US-2026",
        location: "United States",
        currency: "USD",
        tier1EmployeeCapPct: 4,
        tier1EmployerMatchRatePct: 100, // 401(k) match: 100% on first 4%
        tier2EmployeeCapPct: 6,
        tier2EmployerMatchRatePct: 50, // 50% on next 2% (5% max match)
        maxEmployerPensionMatchPct: 5,
        standardHealthAnnualValue: 7200,
        premiumHealthAnnualValue: 12500,
        wellnessAnnualStipend: 1500,
        employerOnCostPct: 11, // ~7.65% FICA + FUTA/SUTA/Workers Comp
      },
    ])
    .onConflictDoNothing();

  console.log("Seeding HR Pay Bands...");
  await db
    .insert(schema.hrPayBand)
    .values([
      // Engineering (Germany - EUR)
      {
        id: "BAND-ENG-IC1-DE",
        department: "Engineering",
        jobLevel: "IC1",
        title: "Associate Software Engineer",
        location: "Germany",
        minSalary: 48000,
        midSalary: 55000,
        maxSalary: 64000,
        currency: "EUR",
      },
      {
        id: "BAND-ENG-IC2-DE",
        department: "Engineering",
        jobLevel: "IC2",
        title: "Software Engineer",
        location: "Germany",
        minSalary: 60000,
        midSalary: 70000,
        maxSalary: 82000,
        currency: "EUR",
      },
      {
        id: "BAND-ENG-IC3-DE",
        department: "Engineering",
        jobLevel: "IC3",
        title: "Mid-Level Software Engineer",
        location: "Germany",
        minSalary: 74000,
        midSalary: 85000,
        maxSalary: 98000,
        currency: "EUR",
      },
      {
        id: "BAND-ENG-IC4-DE",
        department: "Engineering",
        jobLevel: "IC4",
        title: "Senior Software Engineer",
        location: "Germany",
        minSalary: 88000,
        midSalary: 102000,
        maxSalary: 120000,
        currency: "EUR",
      },
      {
        id: "BAND-ENG-IC5-DE",
        department: "Engineering",
        jobLevel: "IC5",
        title: "Staff / Principal Engineer",
        location: "Germany",
        minSalary: 112000,
        midSalary: 130000,
        maxSalary: 155000,
        currency: "EUR",
      },
      {
        id: "BAND-ENG-M2-DE",
        department: "Engineering",
        jobLevel: "M2",
        title: "Engineering Manager",
        location: "Germany",
        minSalary: 105000,
        midSalary: 122000,
        maxSalary: 145000,
        currency: "EUR",
      },

      // Product & Design (Germany - EUR)
      {
        id: "BAND-PRD-IC3-DE",
        department: "Product",
        jobLevel: "IC3",
        title: "Product Manager",
        location: "Germany",
        minSalary: 70000,
        midSalary: 82000,
        maxSalary: 95000,
        currency: "EUR",
      },
      {
        id: "BAND-PRD-IC4-DE",
        department: "Product",
        jobLevel: "IC4",
        title: "Senior Product Manager",
        location: "Germany",
        minSalary: 85000,
        midSalary: 98000,
        maxSalary: 115000,
        currency: "EUR",
      },

      // Sales & Revenue (UK - GBP)
      {
        id: "BAND-SAL-IC3-UK",
        department: "Sales",
        jobLevel: "IC3",
        title: "Account Executive",
        location: "United Kingdom",
        minSalary: 52000,
        midSalary: 62000,
        maxSalary: 75000,
        currency: "GBP",
      },
      {
        id: "BAND-SAL-IC4-UK",
        department: "Sales",
        jobLevel: "IC4",
        title: "Senior Enterprise AE",
        location: "United Kingdom",
        minSalary: 72000,
        midSalary: 85000,
        maxSalary: 105000,
        currency: "GBP",
      },

      // Operations & HR (Germany - EUR)
      {
        id: "BAND-OPS-IC3-DE",
        department: "Operations",
        jobLevel: "IC3",
        title: "Operations & HR Specialist",
        location: "Germany",
        minSalary: 55000,
        midSalary: 64000,
        maxSalary: 75000,
        currency: "EUR",
      },
    ])
    .onConflictDoNothing();

  console.log("Seeding HR Employees...");
  await db
    .insert(schema.hrEmployee)
    .values([
      {
        id: "EMP-001",
        name: "Sarah Jenkins",
        email: "sarah.jenkins@company.internal",
        title: "Senior Software Engineer",
        department: "Engineering",
        jobLevel: "IC4",
        location: "Germany",
        annualSalary: 98000, // EUR
        currency: "EUR",
        standardWeeklyHours: 40,
        pensionContributionPct: 4, // Contributing 4%
        healthTier: "premium",
        bonusTargetPct: 10,
        hireDate: "2022-04-15",
      },
      {
        id: "EMP-002",
        name: "Liam Chen",
        email: "liam.chen@company.internal",
        title: "Mid-Level Software Engineer",
        department: "Engineering",
        jobLevel: "IC3",
        location: "Germany",
        annualSalary: 82000,
        currency: "EUR",
        standardWeeklyHours: 40,
        pensionContributionPct: 3,
        healthTier: "standard",
        bonusTargetPct: 8,
        hireDate: "2023-08-01",
      },
      {
        id: "EMP-003",
        name: "Elena Rostova",
        email: "elena.rostova@company.internal",
        title: "Engineering Manager",
        department: "Engineering",
        jobLevel: "M2",
        location: "Germany",
        annualSalary: 125000,
        currency: "EUR",
        standardWeeklyHours: 40,
        pensionContributionPct: 6,
        healthTier: "premium",
        bonusTargetPct: 15,
        hireDate: "2021-02-10",
      },
      {
        id: "EMP-004",
        name: "Marcus Vance",
        email: "marcus.vance@company.internal",
        title: "Senior Enterprise AE",
        department: "Sales",
        jobLevel: "IC4",
        location: "United Kingdom",
        annualSalary: 88000, // GBP
        currency: "GBP",
        standardWeeklyHours: 37,
        pensionContributionPct: 5,
        healthTier: "standard",
        bonusTargetPct: 25, // Variable sales commission target
        hireDate: "2022-11-01",
      },
      {
        id: "EMP-005",
        name: "Amara Okafor",
        email: "amara.okafor@company.internal",
        title: "Senior Product Manager",
        department: "Product",
        jobLevel: "IC4",
        location: "Germany",
        annualSalary: 96000,
        currency: "EUR",
        standardWeeklyHours: 40,
        pensionContributionPct: 4,
        healthTier: "standard",
        bonusTargetPct: 12,
        hireDate: "2023-01-16",
      },
      {
        id: "EMP-006",
        name: "David Kim",
        email: "david.kim@company.internal",
        title: "Associate Software Engineer",
        department: "Engineering",
        jobLevel: "IC1",
        location: "Germany",
        annualSalary: 52000,
        currency: "EUR",
        standardWeeklyHours: 40,
        pensionContributionPct: 2,
        healthTier: "standard",
        bonusTargetPct: 5,
        hireDate: "2024-06-01",
      },
    ])
    .onConflictDoNothing();

  console.log("Seeding complete!");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
