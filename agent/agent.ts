import Sentry from "@sentry/nextjs";
import { defineAgent, defineDynamic } from "eve";
import { buildModelFromCredential } from "@/agent/model-config";
import { getUserModelPreference, getUserProviderCredential } from "@/lib/db/queries";
import { recordModelFallbackNotice } from "@/lib/model-fallback-notice";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => {
        const userId = ctx.session.auth.current?.principalId;

        if (!userId) {
          return null;
        }

        Sentry.setUser({ id: userId });
        Sentry.setConversationId(ctx.session.id);

        const activeProvider = await getUserModelPreference(userId);

        if (!activeProvider) {
          return null;
        }

        const credential = await getUserProviderCredential(userId, activeProvider);

        if (!credential) {
          return null;
        }

        try {
          return buildModelFromCredential(credential);
        } catch (error) {
          Sentry.logger.warn(
            Sentry.logger.fmt`Falling back to the default model: ${activeProvider} was unusable`,
            {
              activeProvider,
              error: error instanceof Error ? error.message : String(error),
              sessionId: ctx.session.id,
              userId,
            },
          );
          Sentry.metrics.count("model_fallback", 1, {
            attributes: { provider: activeProvider },
          });
          await recordModelFallbackNotice(ctx.session.id, activeProvider);
          return null;
        }
      },
    },
    fallback: "anthropic/claude-sonnet-5",
  }),
});
