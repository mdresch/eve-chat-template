import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const chat = pgTable(
  "chat",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    eveSession: jsonb("eve_session").$type<SessionState | null>(),
    // Docker container backing this chat's sandbox, if any. Set by
    // agent/tools/bash.ts on each bash call — a stable, server-recorded
    // fallback for surfacing which container to attach VS Code to, since
    // reconstructing it client-side from message parts isn't always reliable.
    sandboxContainerName: text("sandbox_container_name"),
    pendingUserMessage: text("pending_user_message"),
    pendingUserMessageCreatedAt: timestamp("pending_user_message_created_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_chat_user_updated").on(table.userId, table.updatedAt),
    index("idx_chat_user_created").on(table.userId, table.createdAt),
  ],
);

export const chatEvent = pgTable(
  "chat_event",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    eventIndex: integer("event_index").notNull(),
    event: jsonb("event").$type<HandleMessageStreamEvent>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_chat_event_chat").on(table.chatId),
    uniqueIndex("idx_chat_event_chat_index").on(table.chatId, table.eventIndex),
  ],
);

export const AI_PROVIDER_VALUES = [
  "anthropic",
  "google",
  "mistral",
  "azure",
  "ollama",
  "foundry-local",
  "bifrost",
  "merge-gateway",
] as const;
export type AiProvider = (typeof AI_PROVIDER_VALUES)[number];

// Providers that need a Base URL field in the settings UI (self-hosted or
// pointed at a non-default endpoint). Distinct from "key optional" — see
// LOCAL_PROVIDERS in app/actions/settings.ts and the settings form.
export const BASE_URL_PROVIDERS: readonly AiProvider[] = [
  "ollama",
  "foundry-local",
  "bifrost",
  "merge-gateway",
];

export const userModelPreference = pgTable("user_model_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  activeProvider: text("active_provider", { enum: AI_PROVIDER_VALUES }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userProviderCredential = pgTable(
  "user_provider_credential",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_PROVIDER_VALUES }).notNull(),
    // Nullable: Ollama/Foundry Local commonly run with no key at all.
    encryptedApiKey: text("encrypted_api_key"),
    model: text("model"), // selected model id; for azure, the deployment name
    azureResourceName: text("azure_resource_name"),
    azureApiVersion: text("azure_api_version"),
    // Ollama/Foundry Local only; e.g. http://localhost:11434/v1
    baseUrl: text("base_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);

export type Chat = typeof chat.$inferSelect;
export type ChatEvent = typeof chatEvent.$inferSelect;
export type User = typeof user.$inferSelect;
export type UserModelPreference = typeof userModelPreference.$inferSelect;
export type UserProviderCredential = typeof userProviderCredential.$inferSelect;

export const hrEmployee = pgTable("hr_employee", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  title: text("title").notNull(),
  department: text("department").notNull(),
  jobLevel: text("job_level").notNull(),
  location: text("location").notNull(),
  annualSalary: integer("annual_salary").notNull(),
  currency: text("currency").notNull().default("EUR"),
  standardWeeklyHours: integer("standard_weekly_hours").notNull().default(40),
  pensionContributionPct: integer("pension_contribution_pct").notNull().default(4),
  healthTier: text("health_tier").notNull().default("standard"),
  bonusTargetPct: integer("bonus_target_pct").notNull().default(10),
  hireDate: text("hire_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const hrPayBand = pgTable(
  "hr_pay_band",
  {
    id: text("id").primaryKey(),
    department: text("department").notNull(),
    jobLevel: text("job_level").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull(),
    minSalary: integer("min_salary").notNull(),
    midSalary: integer("mid_salary").notNull(),
    maxSalary: integer("max_salary").notNull(),
    currency: text("currency").notNull().default("EUR"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_pay_band_dept_level").on(table.department, table.jobLevel),
  ],
);

export const hrBenefitPlan = pgTable("hr_benefit_plan", {
  id: text("id").primaryKey(),
  location: text("location").notNull(),
  currency: text("currency").notNull().default("EUR"),
  tier1EmployeeCapPct: integer("tier1_employee_cap_pct").notNull().default(4),
  tier1EmployerMatchRatePct: integer("tier1_employer_match_rate_pct").notNull().default(100),
  tier2EmployeeCapPct: integer("tier2_employee_cap_pct").notNull().default(6),
  tier2EmployerMatchRatePct: integer("tier2_employer_match_rate_pct").notNull().default(50),
  maxEmployerPensionMatchPct: integer("max_employer_pension_match_pct").notNull().default(5),
  standardHealthAnnualValue: integer("standard_health_annual_value").notNull().default(3600),
  premiumHealthAnnualValue: integer("premium_health_annual_value").notNull().default(6000),
  wellnessAnnualStipend: integer("wellness_annual_stipend").notNull().default(1200),
  employerOnCostPct: integer("employer_on_cost_pct").notNull().default(21),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type HrEmployee = typeof hrEmployee.$inferSelect;
export type HrPayBand = typeof hrPayBand.$inferSelect;
export type HrBenefitPlan = typeof hrBenefitPlan.$inferSelect;
