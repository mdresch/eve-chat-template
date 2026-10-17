CREATE TABLE "hr_benefit_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"location" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"tier1_employee_cap_pct" integer DEFAULT 4 NOT NULL,
	"tier1_employer_match_rate_pct" integer DEFAULT 100 NOT NULL,
	"tier2_employee_cap_pct" integer DEFAULT 6 NOT NULL,
	"tier2_employer_match_rate_pct" integer DEFAULT 50 NOT NULL,
	"max_employer_pension_match_pct" integer DEFAULT 5 NOT NULL,
	"standard_health_annual_value" integer DEFAULT 3600 NOT NULL,
	"premium_health_annual_value" integer DEFAULT 6000 NOT NULL,
	"wellness_annual_stipend" integer DEFAULT 1200 NOT NULL,
	"employer_on_cost_pct" integer DEFAULT 21 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_employee" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"title" text NOT NULL,
	"department" text NOT NULL,
	"job_level" text NOT NULL,
	"location" text NOT NULL,
	"annual_salary" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"standard_weekly_hours" integer DEFAULT 40 NOT NULL,
	"pension_contribution_pct" integer DEFAULT 4 NOT NULL,
	"health_tier" text DEFAULT 'standard' NOT NULL,
	"bonus_target_pct" integer DEFAULT 10 NOT NULL,
	"hire_date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employee_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "hr_pay_band" (
	"id" text PRIMARY KEY NOT NULL,
	"department" text NOT NULL,
	"job_level" text NOT NULL,
	"title" text NOT NULL,
	"location" text NOT NULL,
	"min_salary" integer NOT NULL,
	"mid_salary" integer NOT NULL,
	"max_salary" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_pay_band_dept_level" ON "hr_pay_band" USING btree ("department","job_level");