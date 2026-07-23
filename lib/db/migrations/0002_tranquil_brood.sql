CREATE TABLE "user_model_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_provider" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_provider_credential" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_api_key" text,
	"model" text,
	"azure_resource_name" text,
	"azure_api_version" text,
	"base_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_provider_credential_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "user_model_preference" ADD CONSTRAINT "user_model_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_provider_credential" ADD CONSTRAINT "user_provider_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;