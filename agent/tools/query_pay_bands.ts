import { defineTool } from "eve/tools";
import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export default defineTool({
  description:
    "Query internal transparent pay bands by department, job level, and location, or benchmark a specific employee against their level's compensation band (compa-ratio and band quartile).",
  inputSchema: z.object({
    department: z.string().optional().describe("Department name, e.g. 'Engineering', 'Product', 'Sales', 'Operations'"),
    jobLevel: z.string().optional().describe("Job level code, e.g. 'IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'M2'"),
    location: z.string().optional().describe("Location/country, e.g. 'Germany' or 'United Kingdom'"),
    employeeId: z.string().optional().describe("Optional employee ID (e.g. 'EMP-001') to calculate their compa-ratio and position in band."),
  }),
  async execute({ department, jobLevel, location, employeeId }) {
    let employeeData = null;

    if (employeeId) {
      const [emp] = await db
        .select()
        .from(schema.hrEmployee)
        .where(eq(schema.hrEmployee.id, employeeId.trim().toUpperCase()))
        .limit(1);

      if (emp) {
        employeeData = emp;
        // Auto-populate search filters from employee if omitted
        if (!department) department = emp.department;
        if (!jobLevel) jobLevel = emp.jobLevel;
        if (!location) location = emp.location;
      }
    }

    const conditions = [];
    if (department) conditions.push(ilike(schema.hrPayBand.department, `%${department.trim()}%`));
    if (jobLevel) conditions.push(eq(schema.hrPayBand.jobLevel, jobLevel.trim().toUpperCase()));
    if (location) conditions.push(ilike(schema.hrPayBand.location, `%${location.trim()}%`));

    const bands = await db
      .select()
      .from(schema.hrPayBand)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(15);

    const STANDARD_ANNUAL_HOURS = 2080; // 40 hrs * 52 weeks

    const formattedBands = bands.map((b) => {
      const minHourly = Number((b.minSalary / STANDARD_ANNUAL_HOURS).toFixed(2));
      const midHourly = Number((b.midSalary / STANDARD_ANNUAL_HOURS).toFixed(2));
      const maxHourly = Number((b.maxSalary / STANDARD_ANNUAL_HOURS).toFixed(2));
      const spreadPct = Number((((b.maxSalary - b.minSalary) / b.minSalary) * 100).toFixed(1));

      let employeeComparison = null;
      if (employeeData && employeeData.department.toLowerCase() === b.department.toLowerCase() && employeeData.jobLevel === b.jobLevel) {
        const empHours = (employeeData.standardWeeklyHours || 40) * 52;
        const empHourly = Number((employeeData.annualSalary / empHours).toFixed(2));
        const compaRatio = Number(((employeeData.annualSalary / b.midSalary) * 100).toFixed(1));

        const range = b.maxSalary - b.minSalary;
        let quartile = "Within Band";
        if (employeeData.annualSalary < b.minSalary) {
          quartile = "Below Band Minimum";
        } else if (employeeData.annualSalary > b.maxSalary) {
          quartile = "Above Band Maximum";
        } else {
          const pos = (employeeData.annualSalary - b.minSalary) / range;
          if (pos < 0.25) quartile = "Quartile 1 (Developing / Entry in Level)";
          else if (pos < 0.5) quartile = "Quartile 2 (Growing / Near Midpoint)";
          else if (pos < 0.75) quartile = "Quartile 3 (Proficient / Seasoned in Level)";
          else quartile = "Quartile 4 (Top of Band / Ready for Promotion)";
        }

        employeeComparison = {
          employeeName: employeeData.name,
          employeeSalary: employeeData.annualSalary,
          employeeHourlyRate: empHourly,
          compaRatio: `${compaRatio}%`,
          quartile,
          distanceToMidpoint: `${employeeData.annualSalary >= b.midSalary ? "+" : "-"}${b.currency} ${Math.abs(employeeData.annualSalary - b.midSalary).toLocaleString()}`,
          roomToMax: `${b.currency} ${Math.max(0, b.maxSalary - employeeData.annualSalary).toLocaleString()}`,
        };
      }

      return {
        bandId: b.id,
        department: b.department,
        jobLevel: b.jobLevel,
        title: b.title,
        location: b.location,
        currency: b.currency,
        annualRange: {
          min: b.minSalary,
          mid: b.midSalary,
          max: b.maxSalary,
        },
        hourlyRange: {
          min: minHourly,
          mid: midHourly,
          max: maxHourly,
        },
        spreadPercentage: `${spreadPct}%`,
        employeeComparison,
      };
    });

    return {
      count: formattedBands.length,
      bands: formattedBands,
      transparencyStandard: "European Union Pay Transparency Directive (EU 2023/970) & Equal Pay Aligned",
    };
  },
});
