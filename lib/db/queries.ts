import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import {
  extractContinuationTokenFromEvents,
  extractSessionIdFromEvents,
  isChatTurnSettledEvent,
} from "@/lib/chat/events";
import type { ActiveChat, ChatListItem, ChatListPage, ChatStatus } from "@/lib/chat/types";
import { createFallbackTitle, DEFAULT_CHAT_TITLE } from "@/lib/chat/title";
import type { AiProvider, SandboxProvider } from "@/lib/db/schema";
import {
  chat,
  chatEvent,
  userModelPreference,
  userProviderCredential,
  userSandboxPreference,
} from "@/lib/db/schema";
import { db } from "@/lib/db/client";

const CHAT_HISTORY_PAGE_SIZE = 20;
const STALE_PENDING_MESSAGE_SECONDS = 180;
// Only these last-event types mean the chat is genuinely idle. Anything else —
// including a normal-looking event like "actions.requested" or "message.appended"
// sitting as the LAST recorded event — means a turn started and never settled.
const SETTLED_READY_EVENT_TYPES = new Set([
  "authorization.required",
  "session.completed",
  "session.waiting",
  "turn.completed",
]);

function deriveChatStatus({
  pendingUserMessage,
  pendingUserMessageCreatedAt,
  lastEventType,
}: {
  readonly pendingUserMessage: string | null;
  readonly pendingUserMessageCreatedAt: Date | null;
  readonly lastEventType: string | null;
}): ChatStatus {
  if (pendingUserMessage) {
    const ageSeconds = pendingUserMessageCreatedAt
      ? (Date.now() - pendingUserMessageCreatedAt.getTime()) / 1000
      : Number.POSITIVE_INFINITY;

    return ageSeconds > STALE_PENDING_MESSAGE_SECONDS ? "ended" : "generating";
  }

  if (lastEventType === null) {
    return "ready";
  }

  return SETTLED_READY_EVENT_TYPES.has(lastEventType) ? "ready" : "ended";
}

async function getLastEventTypes(chatIds: readonly string[]): Promise<Map<string, string>> {
  if (chatIds.length === 0) {
    return new Map();
  }

  const result = await db.execute<{ chat_id: string; type: string | null }>(sql`
    SELECT DISTINCT ON (chat_id) chat_id, event->>'type' as type
    FROM chat_event
    WHERE chat_id IN ${chatIds}
    ORDER BY chat_id, event_index DESC
  `);

  const map = new Map<string, string>();

  for (const row of result.rows) {
    if (row.type) {
      map.set(row.chat_id, row.type);
    }
  }

  return map;
}

function encodeChatCursor(updatedAt: Date, id: string) {
  return `${updatedAt.toISOString()}::${id}`;
}

function decodeChatCursor(cursor: string) {
  const [updatedAtRaw, id] = cursor.split("::");

  if (!updatedAtRaw || !id) {
    return null;
  }

  const updatedAt = new Date(updatedAtRaw);

  if (Number.isNaN(updatedAt.getTime())) {
    return null;
  }

  return { id, updatedAt };
}

export async function listChatsByUser(userId: string): Promise<ChatListItem[]> {
  const page = await listChatsPageByUser(userId);

  return [...page.items];
}

export async function listChatsPageByUser(
  userId: string,
  cursor?: string | null,
): Promise<ChatListPage> {
  const cursorValue = cursor?.trim();
  const parsedCursor = cursorValue ? decodeChatCursor(cursorValue) : null;
  const rows = await db
    .select({
      id: chat.id,
      pendingUserMessage: chat.pendingUserMessage,
      pendingUserMessageCreatedAt: chat.pendingUserMessageCreatedAt,
      sandboxContainerName: chat.sandboxContainerName,
      title: chat.title,
      updatedAt: chat.updatedAt,
    })
    .from(chat)
    .where(
      and(
        eq(chat.userId, userId),
        parsedCursor
          ? or(
              lt(chat.updatedAt, parsedCursor.updatedAt),
              and(eq(chat.updatedAt, parsedCursor.updatedAt), lt(chat.id, parsedCursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(chat.updatedAt), desc(chat.id))
    .limit(CHAT_HISTORY_PAGE_SIZE + 1);

  const hasMore = rows.length > CHAT_HISTORY_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, CHAT_HISTORY_PAGE_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];
  const lastEventTypes = await getLastEventTypes(pageRows.map((row) => row.id));

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      sandboxContainerName: row.sandboxContainerName,
      status: deriveChatStatus({
        lastEventType: lastEventTypes.get(row.id) ?? null,
        pendingUserMessage: row.pendingUserMessage,
        pendingUserMessageCreatedAt: row.pendingUserMessageCreatedAt,
      }),
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: hasMore && last ? encodeChatCursor(last.updatedAt, last.id) : null,
  };
}

export async function createChat(
  userId: string,
  {
    pendingUserMessage,
  }: {
    readonly pendingUserMessage?: string;
  } = {},
) {
  const pendingMessage = pendingUserMessage?.trim();
  const pendingMessageCreatedAt = pendingMessage ? new Date() : null;
  const [row] = await db
    .insert(chat)
    .values({
      id: randomUUID(),
      pendingUserMessage: pendingMessage || null,
      pendingUserMessageCreatedAt: pendingMessageCreatedAt,
      title: pendingMessage ? createFallbackTitle(pendingMessage) : DEFAULT_CHAT_TITLE,
      userId,
    })
    .returning({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
    });

  if (!row) {
    throw new Error("Failed to create chat.");
  }

  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getChatForUser(chatId: string, userId: string): Promise<ActiveChat | null> {
  const [row] = await db
    .select({
      id: chat.id,
      title: chat.title,
      eveSession: chat.eveSession,
      pendingUserMessage: chat.pendingUserMessage,
      pendingUserMessageCreatedAt: chat.pendingUserMessageCreatedAt,
      sandboxContainerName: chat.sandboxContainerName,
    })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);

  if (!row) {
    return null;
  }

  const events = await db
    .select({
      createdAt: chatEvent.createdAt,
      event: chatEvent.event,
    })
    .from(chatEvent)
    .where(eq(chatEvent.chatId, chatId))
    .orderBy(asc(chatEvent.eventIndex));

  const eventValues = events.map((eventRow) => eventRow.event);
  const pendingMessageCreatedAt = row.pendingUserMessageCreatedAt;
  const hasCurrentTurnCompleted = Boolean(
    pendingMessageCreatedAt &&
    events.some(
      (eventRow) =>
        eventRow.createdAt >= pendingMessageCreatedAt &&
        isChatTurnSettledEvent(eventRow.event),
    ),
  );

  let resolvedSession: SessionState | undefined = row.eveSession ?? undefined;
  if (!resolvedSession?.sessionId && eventValues.length > 0) {
    const extractedSessionId = extractSessionIdFromEvents(eventValues);
    const extractedToken = extractContinuationTokenFromEvents(eventValues);
    if (extractedSessionId) {
      resolvedSession = {
        sessionId: extractedSessionId,
        continuationToken: extractedToken ?? resolvedSession?.continuationToken,
        streamIndex: resolvedSession?.streamIndex ?? 0,
      };
    }
  }

  return {
    events: eventValues,
    id: row.id,
    pendingUserMessage: hasCurrentTurnCompleted ? null : row.pendingUserMessage,
    sandboxContainerName: row.sandboxContainerName,
    session: resolvedSession,
    title: row.title,
  };
}

export async function markChatPendingMessage({
  chatId,
  message,
  userId,
}: {
  readonly chatId: string;
  readonly message: string;
  readonly userId: string;
}) {
  const pendingMessage = message.trim();

  if (!pendingMessage) {
    throw new Error("Message cannot be empty.");
  }

  const [row] = await db
    .update(chat)
    .set({
      pendingUserMessage: pendingMessage,
      pendingUserMessageCreatedAt: new Date(),
      title: sql<string>`
        case
          when ${chat.title} = ${DEFAULT_CHAT_TITLE}
          then ${createFallbackTitle(pendingMessage)}
          else ${chat.title}
        end
      `,
      updatedAt: new Date(),
    })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .returning({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
    });

  if (!row) {
    throw new Error("Chat not found.");
  }

  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function clearChatPendingMessage({
  chatId,
  userId,
}: {
  readonly chatId: string;
  readonly userId: string;
}) {
  await db
    .update(chat)
    .set({
      pendingUserMessage: null,
      pendingUserMessageCreatedAt: null,
    })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

export async function skipChatAuthorization({
  chatId,
  events,
  session,
  userId,
}: {
  readonly chatId: string;
  readonly events: readonly HandleMessageStreamEvent[];
  readonly session: SessionState;
  readonly userId: string;
}) {
  if (events.length === 0) {
    throw new Error("No authorization events to save.");
  }

  const [ownedChat] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);

  if (!ownedChat) {
    throw new Error("Chat not found.");
  }

  const [lastEvent] = await db
    .select({ eventIndex: chatEvent.eventIndex })
    .from(chatEvent)
    .where(eq(chatEvent.chatId, chatId))
    .orderBy(desc(chatEvent.eventIndex))
    .limit(1);
  const eventIndex = (lastEvent?.eventIndex ?? -1) + 1;

  await db
    .insert(chatEvent)
    .values(
      events.map((event, offset) => ({
        chatId,
        event,
        eventIndex: eventIndex + offset,
        id: randomUUID(),
      })),
    )
    .onConflictDoUpdate({
      set: { event: sql`excluded.event` },
      target: [chatEvent.chatId, chatEvent.eventIndex],
    });

  const [row] = await db
    .update(chat)
    .set({
      eveSession: session,
      pendingUserMessage: null,
      pendingUserMessageCreatedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .returning({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
    });

  if (!row) {
    throw new Error("Chat not found.");
  }

  return {
    chat: {
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    },
    eventCount: events.length,
    eventIndex,
  };
}

// For the sandbox idle-cleanup cron: chats aren't scoped to one user here,
// since this is a system job over every chat with a live sandbox session.
export async function listIdleChatsWithSandboxSession(idleBefore: Date) {
  const rows = await db
    .select({
      eveSession: chat.eveSession,
      id: chat.id,
      sandboxContainerName: chat.sandboxContainerName,
    })
    .from(chat)
    .where(lt(chat.updatedAt, idleBefore));

  return rows
    .map((row) => ({
      chatId: row.id,
      sessionId: row.eveSession?.sessionId ?? null,
      sandboxContainerName: row.sandboxContainerName,
    }))
    .filter(
      (row): row is { chatId: string; sessionId: string; sandboxContainerName: string | null } =>
        row.sessionId !== null,
    );
}

// Called from agent/tools/bash.ts on every bash call, keyed by eve sessionId
// (not chatId — tool execution only knows the eve session, not this app's
// chat row). Records the Docker container server-side so the UI has a
// stable source of truth instead of reconstructing it from message parts.
export async function recordChatSandboxContainer({
  containerName,
  sessionId,
}: {
  readonly containerName: string;
  readonly sessionId: string;
}) {
  await db
    .update(chat)
    .set({ sandboxContainerName: containerName })
    .where(sql`${chat.eveSession}->>'sessionId' = ${sessionId}`);
}

export async function saveChatSessionState({
  chatId,
  session,
  userId,
}: {
  readonly chatId: string;
  readonly session: SessionState;
  readonly userId: string;
}) {
  await db
    .update(chat)
    .set({
      eveSession: session,
    })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

// Called with a debounced/batched buffer of stream deltas from the client
// (see persistStreamEvent in agent-chat.tsx) so a single turn's worth of
// token-level events doesn't turn into one DB round trip per token.
export async function appendChatEvents({
  chatId,
  events,
  userId,
}: {
  readonly chatId: string;
  readonly events: readonly {
    readonly event: HandleMessageStreamEvent;
    readonly eventIndex: number;
  }[];
  readonly userId: string;
}) {
  if (events.length === 0) {
    return;
  }

  const [ownedChat] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);

  if (!ownedChat) {
    throw new Error("Chat not found.");
  }

  await db
    .insert(chatEvent)
    .values(
      events.map(({ event, eventIndex }) => ({
        chatId,
        event,
        eventIndex,
        id: randomUUID(),
      })),
    )
    .onConflictDoUpdate({
      set: { event: sql`excluded.event` },
      target: [chatEvent.chatId, chatEvent.eventIndex],
    });
}

export async function saveChatSnapshot({
  chatId,
  events,
  session,
  userId,
}: {
  readonly chatId: string;
  readonly events: readonly HandleMessageStreamEvent[];
  readonly session: SessionState;
  readonly userId: string;
}) {
  const [ownedChat] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
    .limit(1);

  if (!ownedChat) {
    throw new Error("Chat not found.");
  }

  if (events.length > 0) {
    await db
      .insert(chatEvent)
      .values(
        events.map((event, eventIndex) => ({
          chatId,
          event,
          eventIndex,
          id: randomUUID(),
        })),
      )
      .onConflictDoUpdate({
        set: { event: sql`excluded.event` },
        target: [chatEvent.chatId, chatEvent.eventIndex],
      });
  }

  await db
    .delete(chatEvent)
    .where(and(eq(chatEvent.chatId, chatId), gte(chatEvent.eventIndex, events.length)));

  await db
    .update(chat)
    .set({
      eveSession: session,
      pendingUserMessage: null,
      pendingUserMessageCreatedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

export async function deleteChatForUser(chatId: string, userId: string) {
  await db.delete(chat).where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

export async function getUserModelPreference(userId: string): Promise<AiProvider | null> {
  const [row] = await db
    .select({ activeProvider: userModelPreference.activeProvider })
    .from(userModelPreference)
    .where(eq(userModelPreference.userId, userId))
    .limit(1);

  return row?.activeProvider ?? null;
}

export async function getDefaultDevUserPreference(): Promise<{ userId: string; activeProvider: AiProvider } | null> {
  const [row] = await db
    .select({
      activeProvider: userModelPreference.activeProvider,
      userId: userModelPreference.userId,
    })
    .from(userModelPreference)
    .where(sql`${userModelPreference.activeProvider} IS NOT NULL`)
    .limit(1);

  if (row?.activeProvider) {
    return { activeProvider: row.activeProvider, userId: row.userId };
  }

  const [credRow] = await db
    .select({
      provider: userProviderCredential.provider,
      userId: userProviderCredential.userId,
    })
    .from(userProviderCredential)
    .limit(1);

  if (credRow) {
    return { activeProvider: credRow.provider, userId: credRow.userId };
  }

  return null;
}

export async function getUserProviderCredential(userId: string, provider: AiProvider) {
  const [row] = await db
    .select()
    .from(userProviderCredential)
    .where(and(eq(userProviderCredential.userId, userId), eq(userProviderCredential.provider, provider)))
    .limit(1);

  return row ?? null;
}

// For rendering the settings UI: never includes/decrypts encryptedApiKey.
export async function listUserProviderCredentialSummaries(userId: string) {
  return db
    .select({
      azureApiVersion: userProviderCredential.azureApiVersion,
      azureResourceName: userProviderCredential.azureResourceName,
      baseUrl: userProviderCredential.baseUrl,
      model: userProviderCredential.model,
      provider: userProviderCredential.provider,
      updatedAt: userProviderCredential.updatedAt,
    })
    .from(userProviderCredential)
    .where(eq(userProviderCredential.userId, userId));
}

export async function upsertUserProviderCredential(input: {
  readonly userId: string;
  readonly provider: AiProvider;
  readonly encryptedApiKey: string | null;
  readonly model?: string | null;
  readonly azureResourceName?: string | null;
  readonly azureApiVersion?: string | null;
  readonly baseUrl?: string | null;
}) {
  await db
    .insert(userProviderCredential)
    .values({
      azureApiVersion: input.azureApiVersion ?? null,
      azureResourceName: input.azureResourceName ?? null,
      baseUrl: input.baseUrl ?? null,
      encryptedApiKey: input.encryptedApiKey,
      model: input.model ?? null,
      provider: input.provider,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        azureApiVersion: input.azureApiVersion ?? null,
        azureResourceName: input.azureResourceName ?? null,
        baseUrl: input.baseUrl ?? null,
        encryptedApiKey: input.encryptedApiKey,
        model: input.model ?? null,
        updatedAt: new Date(),
      },
      target: [userProviderCredential.userId, userProviderCredential.provider],
    });
}

export async function setActiveProvider(userId: string, provider: AiProvider | null) {
  await db
    .insert(userModelPreference)
    .values({ activeProvider: provider, userId })
    .onConflictDoUpdate({
      set: { activeProvider: provider, updatedAt: new Date() },
      target: userModelPreference.userId,
    });
}

export async function deleteUserProviderCredential(userId: string, provider: AiProvider) {
  await db
    .delete(userProviderCredential)
    .where(and(eq(userProviderCredential.userId, userId), eq(userProviderCredential.provider, provider)));
}

export type UserSandboxPreferenceSummary = {
  readonly activeSandbox: SandboxProvider | null;
  readonly mcpUrl: string | null;
  readonly remoteHost: string | null;
  readonly repoRoot: string | null;
  readonly defaultSandboxId: string | null;
  readonly dockerImage: string | null;
};

export function getEnvFallbackSandboxPreference(): UserSandboxPreferenceSummary {
  const mcpUrl = process.env.MXC_MCP_URL?.trim() || null;
  const remoteHost = process.env.MXC_REMOTE_HOST?.trim() || null;
  const repoRoot =
    process.env.MXC_REMOTE_REPO_ROOT?.trim() ||
    process.env.MXC_REPO_ROOT?.trim() ||
    null;
  const defaultSandboxId = process.env.MXC_DEFAULT_SANDBOX_ID?.trim() || null;
  const dockerImage = process.env.EVE_DOCKER_IMAGE?.trim() || "node:22-bookworm";

  return {
    activeSandbox: null,
    defaultSandboxId,
    dockerImage,
    mcpUrl,
    remoteHost,
    repoRoot,
  };
}

export async function getUserSandboxPreference(
  userId: string,
): Promise<UserSandboxPreferenceSummary> {
  const envFallback = getEnvFallbackSandboxPreference();
  try {
    const [row] = await db
      .select({
        activeSandbox: userSandboxPreference.activeSandbox,
        defaultSandboxId: userSandboxPreference.defaultSandboxId,
        dockerImage: userSandboxPreference.dockerImage,
        mcpUrl: userSandboxPreference.mcpUrl,
        remoteHost: userSandboxPreference.remoteHost,
        repoRoot: userSandboxPreference.repoRoot,
      })
      .from(userSandboxPreference)
      .where(eq(userSandboxPreference.userId, userId))
      .limit(1);

    if (!row) {
      return envFallback;
    }

    return {
      activeSandbox: row.activeSandbox ?? null,
      defaultSandboxId: row.defaultSandboxId ?? envFallback.defaultSandboxId,
      dockerImage: row.dockerImage ?? envFallback.dockerImage,
      mcpUrl: row.mcpUrl ?? envFallback.mcpUrl,
      remoteHost: row.remoteHost ?? envFallback.remoteHost,
      repoRoot: row.repoRoot ?? envFallback.repoRoot,
    };
  } catch {
    return envFallback;
  }
}

export async function getDefaultDevSandboxPreference(): Promise<UserSandboxPreferenceSummary> {
  const envFallback = getEnvFallbackSandboxPreference();
  try {
    const [row] = await db
      .select({
        activeSandbox: userSandboxPreference.activeSandbox,
        defaultSandboxId: userSandboxPreference.defaultSandboxId,
        dockerImage: userSandboxPreference.dockerImage,
        mcpUrl: userSandboxPreference.mcpUrl,
        remoteHost: userSandboxPreference.remoteHost,
        repoRoot: userSandboxPreference.repoRoot,
      })
      .from(userSandboxPreference)
      .limit(1);

    if (!row) {
      return envFallback;
    }

    return {
      activeSandbox: row.activeSandbox ?? null,
      defaultSandboxId: row.defaultSandboxId ?? envFallback.defaultSandboxId,
      dockerImage: row.dockerImage ?? envFallback.dockerImage,
      mcpUrl: row.mcpUrl ?? envFallback.mcpUrl,
      remoteHost: row.remoteHost ?? envFallback.remoteHost,
      repoRoot: row.repoRoot ?? envFallback.repoRoot,
    };
  } catch {
    return envFallback;
  }
}

export async function setActiveSandbox(
  userId: string,
  activeSandbox: SandboxProvider | null,
) {
  await db
    .insert(userSandboxPreference)
    .values({ activeSandbox, userId })
    .onConflictDoUpdate({
      set: { activeSandbox, updatedAt: new Date() },
      target: userSandboxPreference.userId,
    });
}

export async function upsertUserSandboxPreference(input: {
  readonly userId: string;
  readonly activeSandbox: SandboxProvider | null;
  readonly mcpUrl?: string | null;
  readonly remoteHost?: string | null;
  readonly repoRoot?: string | null;
  readonly defaultSandboxId?: string | null;
  readonly dockerImage?: string | null;
}) {
  await db
    .insert(userSandboxPreference)
    .values({
      activeSandbox: input.activeSandbox,
      defaultSandboxId: input.defaultSandboxId ?? null,
      dockerImage: input.dockerImage ?? null,
      mcpUrl: input.mcpUrl ?? null,
      remoteHost: input.remoteHost ?? null,
      repoRoot: input.repoRoot ?? null,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        activeSandbox: input.activeSandbox,
        defaultSandboxId: input.defaultSandboxId ?? null,
        dockerImage: input.dockerImage ?? null,
        mcpUrl: input.mcpUrl ?? null,
        remoteHost: input.remoteHost ?? null,
        repoRoot: input.repoRoot ?? null,
        updatedAt: new Date(),
      },
      target: userSandboxPreference.userId,
    });
}
