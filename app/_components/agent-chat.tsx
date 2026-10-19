"use client";

import type {
  AuthorizationRequiredStreamEvent,
  ClientSession,
  EveAgentStoreSnapshot,
  EveMessageData,
  HandleMessageStreamEvent,
  SendTurnInput,
  SessionState,
} from "eve/client";
import type { EveMessage } from "eve/react";
import { defaultMessageReducer, useEveAgent } from "eve/react";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  LockIcon,
  PlugIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  checkModelFallbackNoticeAction,
  checkSendLimitAction,
  clearChatPendingMessageAction,
  createChatAction,
  markChatPendingMessageAction,
  saveChatSessionStateAction,
} from "@/app/actions/chat";
import {
  useChatShell,
  type EnabledConnections,
} from "@/app/_components/chat-shell-context";
import {
  ChatConversation,
  ChatConversationContent,
  ChatScrollButton,
} from "@/components/chat/conversation";
import { IntegrationsMenu } from "@/components/chat/integrations-menu";
import { AgentMessage, needsInputResponse } from "@/components/chat/message";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  extractContinuationTokenFromEvents,
  extractSessionIdFromEvents,
  isChatTurnSettledEvent,
  isStreamTurnBoundaryEvent,
} from "@/lib/chat/events";
import { getChatMessageLengthError } from "@/lib/chat/limits";
import {
  findLatestSandboxContainerName,
  findSandboxContainerNameFromEvents,
} from "@/lib/chat/sandbox";
import { SandboxTelemetryBadge } from "@/components/chat/sandbox-telemetry-badge";
import { TaskProgressIndicator } from "@/components/chat/task-progress";
import type { ActiveChat, SetupStatus, Viewer } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

type AgentSnapshot = EveAgentStoreSnapshot<EveMessageData>;
type PersistedClientSession = ClientSession & {
  readonly state: SessionState;
  applyLocalEvents: (events: readonly HandleMessageStreamEvent[]) => SessionState;
  setState: (session: SessionState) => void;
};
type StreamSessionOptions = {
  readonly ignoreLeadingWaiting?: boolean;
  readonly signal?: AbortSignal;
  readonly startIndex?: number;
};

export type DraftHandlers = {
  readonly clearDraft: () => void;
  readonly restoreDraft: (value: string) => void;
};

export type AgentChatController = {
  readonly reset: () => void;
  readonly sendMessage: (text: string, draftHandlers: DraftHandlers) => Promise<void>;
  readonly stop: () => void;
};

export type AgentChatControllerStatus = {
  readonly disabledReason?: string;
  readonly isBusy: boolean;
  readonly isDisabled: boolean;
  readonly isEmpty: boolean;
};

const IDLE_CONTROLLER_STATUS: AgentChatControllerStatus = {
  isBusy: false,
  isDisabled: false,
  isEmpty: true,
};

const EVE_CREATE_SESSION_PATH = "/eve/v1/session";
const EVE_SESSION_ID_HEADER = "x-eve-session-id";
const STREAM_OPEN_RETRYABLE_STATUS = new Set([404, 409, 425, 500, 502, 503, 504]);
const STREAM_DISCONNECT_RECONNECT_ATTEMPTS = 3;
const STREAM_IDLE_TIMEOUT_MS = 120_000;
const STREAM_RECONNECT_DELAY_MS = 350;
const THINKING_EXIT_DURATION_MS = 180;
// Live streaming can produce hundreds of deltas per turn; persisting each one
// as its own request would mean hundreds of round trips. Batch them and flush
// on this cadence, or immediately once the buffer fills or a turn boundary
// arrives, so resume-after-refresh still sees fairly fresh history.
const EVENT_FLUSH_DEBOUNCE_MS = 250;
const EVENT_FLUSH_MAX_BATCH = 25;
// useEveAgent's own live stream transport has no idle timeout — it only
// recovers from a thrown disconnect error. A connection that silently stalls
// (backgrounded tab throttling, an intermediate proxy holding the socket
// open) never errors and never progresses, so `agent.status` sticks on
// "streaming" forever with no recovery path. See the watchdog effect below.
const LIVE_STREAM_WATCHDOG_POLL_MS = 5_000;
// agent/sandbox.ts's onSession records the container name server-side as
// soon as the sandbox opens, but nothing pushes that to the client mid-turn
// — the client otherwise only re-learns it at a turn boundary. Poll for it
// while a turn is open and we don't have a name yet, so the sidebar/header
// icon can appear well before the turn finishes.
const SANDBOX_POLL_INTERVAL_MS = 4_000;

function createPersistedClientSession({
  getActiveChatSession,
  getEvents,
  initialSession,
  onSessionStarted,
}: {
  readonly getActiveChatSession?: () => SessionState | undefined;
  readonly getEvents?: () => readonly HandleMessageStreamEvent[];
  readonly initialSession?: SessionState;
  readonly onSessionStarted: (session: SessionState) => Promise<void> | void;
}) {
  let session = initialSession ?? createInitialSessionState();

  return {
    get state() {
      return session;
    },
    async send(input: SendTurnInput) {
      const activeChatSession = getActiveChatSession?.();
      if (!session.sessionId && activeChatSession?.sessionId) {
        session = {
          ...activeChatSession,
          continuationToken:
            activeChatSession.continuationToken ?? session.continuationToken,
          streamIndex: Math.max(session.streamIndex, activeChatSession.streamIndex),
        };
      }

      const allEvents = getEvents?.() ?? [];
      const tokenFromEvents = extractContinuationTokenFromEvents(allEvents);
      const sessionIdFromEvents = extractSessionIdFromEvents(allEvents);
      const resolvedSessionId =
        session.sessionId || activeChatSession?.sessionId || sessionIdFromEvents;
      const resolvedContinuationToken =
        session.continuationToken || tokenFromEvents || activeChatSession?.continuationToken;

      const previousSession = {
        ...session,
        continuationToken: resolvedContinuationToken,
        sessionId: resolvedSessionId,
      };

      const normalizedInput = normalizeSendInput(input);
      const sessionToSend = previousSession;
      const response = await postSessionTurn(sessionToSend, normalizedInput);
      const startedSession = {
        ...sessionToSend,
        continuationToken:
          response.continuationToken ?? sessionToSend.continuationToken,
        sessionId: response.sessionId,
        streamIndex:
          sessionToSend.sessionId === response.sessionId ? sessionToSend.streamIndex : 0,
      };

      session = startedSession;

      await onSessionStarted(startedSession);

      return createBrowserMessageResponse({
        continuationToken: response.continuationToken,
        ignoreLeadingWaiting:
          Boolean(previousSession.sessionId) &&
          previousSession.sessionId === response.sessionId &&
          startedSession.streamIndex > 0,
        onFinalize: (events) => {
          session = advanceBrowserSession({
            baseStreamIndex: startedSession.streamIndex,
            continuationToken: response.continuationToken,
            events,
            session: startedSession,
            sessionId: response.sessionId,
          });
        },
        sessionId: response.sessionId,
        signal: normalizedInput.signal,
        startIndex: startedSession.streamIndex,
      });
    },
    stream(options?: StreamSessionOptions) {
      const sessionId = session.sessionId;

      if (!sessionId) {
        throw new Error("Session has no session ID. Send a message first.");
      }

      const startIndex = options?.startIndex ?? session.streamIndex;

      return streamSessionEvents({
        ignoreLeadingWaiting: options?.ignoreLeadingWaiting,
        onFinalize: (events) => {
          session = advanceBrowserSession({
            baseStreamIndex: startIndex,
            continuationToken: session.continuationToken,
            events,
            session,
            sessionId,
          });
        },
        sessionId,
        signal: options?.signal,
        startIndex,
      });
    },
    applyLocalEvents(events: readonly HandleMessageStreamEvent[]) {
      if (!session.sessionId) {
        throw new Error("Session has no session ID.");
      }

      session = advanceBrowserSession({
        baseStreamIndex: session.streamIndex,
        continuationToken: session.continuationToken,
        events,
        session,
        sessionId: session.sessionId,
      });

      return session;
    },
    setState(nextSession: SessionState) {
      session = nextSession;
    },
  } as unknown as PersistedClientSession;
}

function createInitialSessionState(): SessionState {
  return { streamIndex: 0 };
}

function normalizeSendInput(input: SendTurnInput) {
  return typeof input === "string" ? { message: input } : input;
}

async function postSessionTurn(
  session: SessionState,
  input: ReturnType<typeof normalizeSendInput>,
) {
  const body = createHandleMessageBody({ input, session });

  if (!body) {
    throw new Error("Session turn requires a message or input response.");
  }

  if (body.inputResponses && !session.sessionId) {
    throw new Error("Session is not ready to accept input response.");
  }

  const response = await fetch(
    session.sessionId
      ? `/eve/v1/session/${encodeURIComponent(session.sessionId)}`
      : EVE_CREATE_SESSION_PATH,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...input.headers,
      },
      method: "POST",
      signal: input.signal ?? null,
    },
  );

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const payload = await response.json() as {
    readonly continuationToken?: unknown;
    readonly sessionId?: unknown;
  };
  const sessionId =
    (typeof payload.sessionId === "string" ? payload.sessionId : undefined) ??
    response.headers.get(EVE_SESSION_ID_HEADER)?.trim();

  if (!sessionId) {
    throw new Error("Message route did not return a session id.");
  }

  return {
    continuationToken:
      typeof payload.continuationToken === "string"
        ? payload.continuationToken
        : undefined,
    sessionId,
  };
}

function createHandleMessageBody({
  input,
  session,
}: {
  readonly input: ReturnType<typeof normalizeSendInput>;
  readonly session: SessionState;
}) {
  const body: Record<string, unknown> = {};

  if (input.message !== undefined) {
    body.message = input.message;
  }

  if (input.inputResponses !== undefined && input.inputResponses.length > 0) {
    body.inputResponses = input.inputResponses;
  }

  if (input.clientContext !== undefined) {
    body.clientContext = input.clientContext;
  }

  if (input.outputSchema !== undefined) {
    body.outputSchema = input.outputSchema;
  }

  if (session.continuationToken !== undefined) {
    body.continuationToken = session.continuationToken;
  }

  if (Object.keys(body).length === 0) {
    return null;
  }

  const hasMessage = body.message !== undefined && body.message !== null;
  const hasInputResponses =
    Array.isArray(body.inputResponses) && body.inputResponses.length > 0;

  if (!hasMessage && !hasInputResponses) {
    return null;
  }

  return body;
}

function createBrowserMessageResponse({
  continuationToken,
  ignoreLeadingWaiting = false,
  onFinalize,
  sessionId,
  signal,
  startIndex,
}: {
  readonly continuationToken?: string;
  readonly ignoreLeadingWaiting?: boolean;
  readonly onFinalize: (events: readonly HandleMessageStreamEvent[]) => void;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly startIndex: number;
}) {
  let consumed = false;

  return {
    continuationToken,
    sessionId,
    [Symbol.asyncIterator]() {
      if (consumed) {
        throw new Error("MessageResponse has already been consumed.");
      }

      consumed = true;

      return streamSessionEvents({
        ignoreLeadingWaiting,
        onFinalize,
        sessionId,
        signal,
        startIndex,
      })[Symbol.asyncIterator]();
    },
  };
}

async function* streamSessionEvents({
  ignoreLeadingWaiting = false,
  onFinalize,
  sessionId,
  signal,
  startIndex,
}: {
  readonly ignoreLeadingWaiting?: boolean;
  readonly onFinalize: (events: readonly HandleMessageStreamEvent[]) => void;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly startIndex: number;
}) {
  const events: HandleMessageStreamEvent[] = [];
  let nextIndex = startIndex;
  let disconnectReconnectsRemaining = STREAM_DISCONNECT_RECONNECT_ATTEMPTS;
  let lastProgressAt = Date.now();

  try {
    for (;;) {
      let disconnected = false;
      let foundBoundary = false;
      const body = await openStreamBody({ sessionId, signal, startIndex: nextIndex });

      try {
        for await (const event of readNdjsonStream(body)) {
          events.push(event);
          nextIndex += 1;
          lastProgressAt = Date.now();
          disconnectReconnectsRemaining = STREAM_DISCONNECT_RECONNECT_ATTEMPTS;
          yield event;

          const isStaleLeadingWaiting =
            ignoreLeadingWaiting &&
            events.length === 1 &&
            event.type === "session.waiting";

          if (isStreamTurnBoundaryEvent(event) && !isStaleLeadingWaiting) {
            foundBoundary = true;
            break;
          }
        }
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        if (!isStreamDisconnectError(error)) {
          throw error;
        }

        disconnected = true;
      }

      if (foundBoundary || signal?.aborted) {
        return;
      }

      if (Date.now() - lastProgressAt >= STREAM_IDLE_TIMEOUT_MS) {
        return;
      }

      if (disconnected) {
        if (disconnectReconnectsRemaining <= 0) {
          return;
        }

        disconnectReconnectsRemaining -= 1;
      }

      await sleep(STREAM_RECONNECT_DELAY_MS);
    }
  } finally {
    onFinalize(events);
  }
}

async function openStreamBody({
  sessionId,
  signal,
  startIndex,
}: {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly startIndex: number;
}) {
  const path = `/eve/v1/session/${encodeURIComponent(sessionId)}/stream`;
  const query = startIndex > 0 ? `?${new URLSearchParams({ startIndex: String(startIndex) })}` : "";
  let status = 0;
  let body = "Failed to open message stream.";

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${path}${query}`, {
      signal: signal ?? null,
    });

    if (response.ok) {
      if (!response.body) {
        throw new Error("Response body is null.");
      }

      return response.body;
    }

    status = response.status;
    body = await response.text();

    if (!STREAM_OPEN_RETRYABLE_STATUS.has(response.status)) {
      throw new Error(formatResponseError(status, body));
    }

    if (attempt < 11) {
      await sleep(250);
    }
  }

  throw new Error(formatResponseError(status, body));
}

async function* readNdjsonStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          yield JSON.parse(line) as HandleMessageStreamEvent;
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    const line = buffer.trim();

    if (line.length > 0) {
      yield JSON.parse(line) as HandleMessageStreamEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

function advanceBrowserSession({
  baseStreamIndex,
  continuationToken,
  events,
  session,
  sessionId,
}: {
  readonly baseStreamIndex: number;
  readonly continuationToken?: string;
  readonly events: readonly HandleMessageStreamEvent[];
  readonly session: SessionState;
  readonly sessionId: string;
}) {
  const boundary = findBoundaryEvent(events);
  const eventToken = extractContinuationTokenFromEvents(events);
  const resolvedToken = eventToken ?? continuationToken ?? session.continuationToken;

  if (boundary?.type === "session.completed" || boundary?.type === "session.failed") {
    return createInitialSessionState();
  }

  return {
    continuationToken: resolvedToken,
    sessionId,
    streamIndex: baseStreamIndex + events.length,
  };
}

function findBoundaryEvent(events: readonly HandleMessageStreamEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event && isChatTurnSettledEvent(event)) {
      return event;
    }
  }
}

function statusFromSettledEvents(events: readonly HandleMessageStreamEvent[]) {
  const boundary = findBoundaryEvent(events);

  // No boundary at all means the turn never reached a settled event (the
  // stream idle-timed-out or disconnected mid-turn) — that's not "ready".
  return !boundary || boundary.type === "turn.failed" || boundary.type === "session.failed"
    ? ("ended" as const)
    : ("ready" as const);
}

function reduceEventsToMessageData(
  events: readonly HandleMessageStreamEvent[],
): EveMessageData {
  const reducer = defaultMessageReducer();
  let data = reducer.initial();

  for (const event of events) {
    data = reducer.reduce(data, event);
  }

  return data;
}

function deriveSandboxContainerName(events: readonly HandleMessageStreamEvent[]) {
  return findLatestSandboxContainerName(reduceEventsToMessageData(events).messages);
}

function hasOpenChatTurn(events: readonly HandleMessageStreamEvent[]) {
  let open = false;

  for (const event of events) {
    if (event.type === "turn.started") {
      open = true;
    } else if (isChatTurnSettledEvent(event)) {
      open = false;
    }
  }

  return open;
}

type ChatEventBatchEntry = {
  readonly event: HandleMessageStreamEvent;
  readonly eventIndex: number;
};

async function postChatEvents(chatId: string, events: readonly ChatEventBatchEntry[]) {
  if (events.length === 0) {
    return;
  }

  const response = await fetch(`/api/chats/${chatId}/events`, {
    body: JSON.stringify({ events }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    throw new Error(body?.error ?? "Failed to save chat events.");
  }
}

// Carries the full chat history (used to reconcile the DB at turn end / after
// a resume) — same reasoning as postChatEvents for why this is a route
// handler and not a Server Action.
async function postChatSnapshot(
  chatId: string,
  events: readonly HandleMessageStreamEvent[],
  session: SessionState,
) {
  const response = await fetch(`/api/chats/${chatId}/snapshot`, {
    body: JSON.stringify({ events, session }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    throw new Error(body?.error ?? "Failed to save chat snapshot.");
  }
}

async function postSkipChatAuthorization(
  chatId: string,
  events: readonly HandleMessageStreamEvent[],
  session: SessionState,
) {
  const response = await fetch(`/api/chats/${chatId}/skip-authorization`, {
    body: JSON.stringify({ events, session }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as {
    readonly chat?: { readonly id: string; readonly title: string; readonly updatedAt: string };
    readonly error?: string;
    readonly eventCount?: number;
    readonly eventIndex?: number;
  } | null;

  if (
    !response.ok ||
    !body?.chat ||
    body.eventCount === undefined ||
    body.eventIndex === undefined
  ) {
    throw new Error(body?.error ?? "Failed to skip authorization.");
  }

  return { chat: body.chat, eventCount: body.eventCount, eventIndex: body.eventIndex };
}

function namespaceStreamEvent(
  event: HandleMessageStreamEvent,
  namespace: string | undefined,
): HandleMessageStreamEvent {
  if (!namespace) {
    return event;
  }

  if (!("data" in event) || typeof event.data !== "object" || !event.data) {
    return event;
  }

  const turnId =
    "turnId" in event.data && typeof event.data.turnId === "string"
      ? event.data.turnId
      : undefined;

  if (!turnId) {
    return event;
  }

  const prefix = `${namespace}:`;

  if (turnId.startsWith(prefix)) {
    return event;
  }

  return {
    ...event,
    data: {
      ...event.data,
      turnId: `${prefix}${turnId}`,
    },
  } as HandleMessageStreamEvent;
}

function isSnapshotForCurrentSession(
  snapshotSession: SessionState,
  currentSession: SessionState | undefined,
) {
  if (!snapshotSession.sessionId) {
    return true;
  }

  return snapshotSession.sessionId === currentSession?.sessionId;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isStreamDisconnectError(error: unknown) {
  if (isAbortError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;

  return (
    error.name === "AbortError" ||
    error.message === "terminated" ||
    code === "UND_ERR_SOCKET" ||
    /abort|cancel|disconnect|premature close|socket|terminated/i.test(error.message)
  );
}

async function readResponseError(response: Response) {
  return formatResponseError(response.status, await response.text());
}

function formatResponseError(status: number, body: string) {
  if (body.length > 0) {
    try {
      const parsed = JSON.parse(body) as { readonly error?: unknown };

      if (typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {}

    return body;
  }

  return `Server returned ${status}.`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function AgentChatSession({
  activeChat,
  chatId,
  emptyComposer,
  onActiveChatUpdated,
  onPendingUserMessageSettled,
  onControllerChange,
  pendingUserMessage,
}: {
  readonly activeChat: ActiveChat | null;
  readonly chatId?: string | null;
  readonly emptyComposer?: ReactNode;
  readonly onActiveChatUpdated?: (activeChat: ActiveChat) => void;
  readonly onPendingUserMessageSettled?: (message?: string) => void;
  readonly onControllerChange: (
    controller: AgentChatController | null,
    status: AgentChatControllerStatus,
  ) => void;
  readonly pendingUserMessage?: string | null;
}) {
  const {
    activeChatId: shellActiveChatId,
    enabledConnections,
    requestSignIn,
    setActiveChatId: setShellActiveChatId,
    setupStatus,
    touchChat,
    viewer,
  } = useChatShell();
  const [activeChatId, setActiveChatId] = useState(activeChat?.id ?? chatId ?? null);
  const [currentTitle, setCurrentTitle] = useState(activeChat?.title ?? "New chat");
  const [clientError, setClientError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [resumedEvents, setResumedEvents] = useState<HandleMessageStreamEvent[]>([]);
  const [isResuming, setIsResuming] = useState(false);
  const [isFinalizingTurn, setIsFinalizingTurn] = useState(false);
  const [streamEvents, setStreamEvents] = useState<HandleMessageStreamEvent[]>([]);
  const [localEvents, setLocalEvents] = useState<HandleMessageStreamEvent[]>([]);
  const [polledSandboxContainerName, setPolledSandboxContainerName] = useState<string | null>(
    null,
  );
  const {
    clearMessage: clearLocalPendingUserMessage,
    message: localPendingUserMessage,
    messageRef: localPendingUserMessageRef,
    setMessage: setLocalPendingUserMessage,
  } = usePendingUserMessage();
  const [skippingAuthorizationKey, setSkippingAuthorizationKey] = useState<string | null>(null);
  const activeChatIdRef = useRef(activeChat?.id ?? chatId ?? null);
  const eventIndexRef = useRef(activeChat?.events.length ?? 0);
  const eventIndexChatIdRef = useRef(activeChat?.id ?? chatId ?? null);
  const knownInitialEventsRef = useRef<readonly HandleMessageStreamEvent[]>(
    activeChat?.events ?? [],
  );
  const currentTitleRef = useRef(activeChat?.title ?? "New chat");
  const resumeStartedRef = useRef(false);
  const resumeAbortControllerRef = useRef<AbortController | null>(null);
  const resumedEventsRef = useRef<HandleMessageStreamEvent[]>([]);
  const streamEventsRef = useRef<HandleMessageStreamEvent[]>([]);
  const streamEventKeysRef = useRef<Set<string>>(new Set());
  const pendingEventBatchRef = useRef<ChatEventBatchEntry[]>([]);
  const eventFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastLiveStreamProgressAtRef = useRef<number | null>(null);
  const localEventsRef = useRef<HandleMessageStreamEvent[]>([]);
  const onSessionStartedRef = useRef<(session: SessionState) => Promise<void> | void>(
    () => {},
  );
  const persistedSessionRef = useRef<PersistedClientSession | null>(null);
  persistedSessionRef.current ??= createPersistedClientSession({
    getActiveChatSession: () => activeChat?.session,
    getEvents: () => [
      ...knownInitialEventsRef.current,
      ...streamEventsRef.current,
      ...localEventsRef.current,
    ],
    initialSession: activeChat?.session,
    onSessionStarted: (session) => onSessionStartedRef.current(session),
  });
  const isSetupReady = setupStatus.appReady;
  const router = useRouter();

  const startFinalizingTurn = useCallback(() => {
    setIsFinalizingTurn(true);
  }, []);

  const stopFinalizingTurn = useCallback(() => {
    setIsFinalizingTurn(false);
  }, []);

  const finishFinalizingTurn = useCallback(() => {
    setIsFinalizingTurn(false);
  }, []);

  const persistSnapshot = useCallback(
    async (snapshot: AgentSnapshot) => {
      const chatId = activeChatIdRef.current;

      if (!viewer || !chatId) {
        stopFinalizingTurn();
        return;
      }

      setClientError(null);

      try {
        if (
          !isSnapshotForCurrentSession(
            snapshot.session,
            persistedSessionRef.current?.state,
          )
        ) {
          stopFinalizingTurn();
          return;
        }

        const snapshotEvents =
          streamEventsRef.current.length > 0
            ? mergeStreamEventLogs(
                knownInitialEventsRef.current,
                streamEventsRef.current,
              )
            : preserveKnownInitialEvents(
                snapshot.events,
                knownInitialEventsRef.current,
              );
        const events = mergeLocalEvents(snapshotEvents, localEventsRef.current);

        const session = advanceSessionWithLocalEvents(
          snapshot.session,
          localEventsRef.current,
        );

        await postChatSnapshot(chatId, events, session);

        if (session.sessionId) {
          void checkModelFallbackNoticeAction(session.sessionId).then((provider) => {
            if (provider) {
              setProviderNotice(
                "Your selected AI provider was unavailable for this reply — used the default instead.",
              );
            }
          });
        }

        eventIndexRef.current = events.length;
        knownInitialEventsRef.current = events;
        streamEventsRef.current = [];
        streamEventKeysRef.current = new Set();
        setStreamEvents([]);

        if (hasOpenChatTurn(events)) {
          // The stream ended without the turn ever settling (idle timeout or
          // disconnect). Surface the same retry affordance used after a
          // reload, right here in the live tab.
          setResumeFailed(true);
        }

        const nextSandboxContainerName = deriveSandboxContainerName(events);

        touchChat({
          id: chatId,
          sandboxContainerName: nextSandboxContainerName,
          status: statusFromSettledEvents(events),
          title: currentTitleRef.current,
          updatedAt: new Date().toISOString(),
        });
        onActiveChatUpdated?.({
          events,
          id: chatId,
          pendingUserMessage: null,
          sandboxContainerName: nextSandboxContainerName,
          session,
          title: currentTitleRef.current,
        });
        onPendingUserMessageSettled?.();

      } catch (error) {
        setClientError(error instanceof Error ? error.message : "Failed to save chat.");
      } finally {
        finishFinalizingTurn();
      }
    },
    [
      finishFinalizingTurn,
      onActiveChatUpdated,
      onPendingUserMessageSettled,
      stopFinalizingTurn,
      touchChat,
      viewer,
    ],
  );

  const flushPendingChatEvents = useCallback(() => {
    if (eventFlushTimeoutRef.current !== undefined) {
      clearTimeout(eventFlushTimeoutRef.current);
      eventFlushTimeoutRef.current = undefined;
    }

    const batch = pendingEventBatchRef.current;

    if (batch.length === 0) {
      return;
    }

    pendingEventBatchRef.current = [];

    const chatId = activeChatIdRef.current;

    if (!chatId) {
      return;
    }

    void postChatEvents(chatId, batch).catch((error) => {
      setClientError(
        error instanceof Error ? error.message : "Failed to save stream progress.",
      );
    });
  }, []);

  const persistStreamEvent = useCallback(
    (event: HandleMessageStreamEvent) => {
      lastLiveStreamProgressAtRef.current = Date.now();

      const displayEvent = namespaceStreamEvent(
        event,
        persistedSessionRef.current?.state.sessionId,
      );
      const nextStreamEvents = appendUniqueStreamEvent(
        streamEventsRef.current,
        displayEvent,
        streamEventKeysRef.current,
      );

      if (nextStreamEvents !== streamEventsRef.current) {
        streamEventsRef.current = nextStreamEvents;
        setStreamEvents(nextStreamEvents);
      }

      if (
        displayEvent.type === "authorization.required" ||
        displayEvent.type === "turn.failed" ||
        displayEvent.type === "session.failed" ||
        displayEvent.type === "turn.completed"
      ) {
        stopFinalizingTurn();
      }

      if (displayEvent.type === "turn.failed" || displayEvent.type === "session.failed") {
        setResumeFailed(true);
      }

      const chatId = activeChatIdRef.current;

      if (!viewer || !chatId) {
        return;
      }

      const eventIndex = eventIndexRef.current;
      eventIndexRef.current += 1;

      pendingEventBatchRef.current.push({ event: displayEvent, eventIndex });

      if (
        isChatTurnSettledEvent(displayEvent) ||
        pendingEventBatchRef.current.length >= EVENT_FLUSH_MAX_BATCH
      ) {
        flushPendingChatEvents();
        return;
      }

      if (eventFlushTimeoutRef.current === undefined) {
        eventFlushTimeoutRef.current = setTimeout(() => {
          eventFlushTimeoutRef.current = undefined;
          flushPendingChatEvents();
        }, EVENT_FLUSH_DEBOUNCE_MS);
      }
    },
    [flushPendingChatEvents, stopFinalizingTurn, viewer],
  );

  const persistSessionState = useCallback(
    async (session: SessionState) => {
      const chatId = activeChatIdRef.current;

      if (!viewer || !chatId || !session.sessionId) {
        return;
      }

      try {
        await saveChatSessionStateAction({
          chatId,
          session,
        });
      } catch (error) {
        setClientError(
          error instanceof Error ? error.message : "Failed to save session state.",
        );
      }
    },
    [viewer],
  );

  onSessionStartedRef.current = persistSessionState;

  const agent = useEveAgent({
    initialEvents: activeChat?.events ?? [],
    session: persistedSessionRef.current,
    onEvent: persistStreamEvent,
    onFinish: (snapshot) => {
      void persistSnapshot(snapshot);
    },
  });

  const hasResumeOverlay = isResuming || (resumedEvents.length > 0 && streamEvents.length === 0);
  const resumedEventLog = useMemo(
    () => [...(activeChat?.events ?? []), ...resumedEvents],
    [activeChat?.events, resumedEvents],
  );
  const agentEventLog = useMemo(
    () => mergeStreamEventLogs(activeChat?.events ?? [], streamEvents),
    [activeChat?.events, streamEvents],
  );
  const baseDisplayEvents = hasResumeOverlay ? resumedEventLog : agentEventLog;
  const displayEvents = useMemo(
    () => mergeLocalEvents(baseDisplayEvents, localEvents),
    [baseDisplayEvents, localEvents],
  );
  const displayData = useMemo(() => reduceEventsToMessageData(displayEvents), [displayEvents]);
  const displayMessages = displayData.messages;
  const derivedSandboxContainerName = useMemo(
    () =>
      findSandboxContainerNameFromEvents(displayEvents) ??
      findLatestSandboxContainerName(displayMessages),
    [displayEvents, displayMessages],
  );
  // Prefer the server-recorded value (set by agent/sandbox.ts's onSession and
  // agent/tools/bash.ts, keyed by eve sessionId) — it's a stable source of
  // truth. The client-derived fallback only matters mid-turn, before
  // onActiveChatUpdated or the poll below has caught up.
  const sandboxContainerName =
    activeChat?.sandboxContainerName ?? polledSandboxContainerName ?? derivedSandboxContainerName;
  const displayChatId = chatId ?? activeChatId ?? "new";
  const hasLocalPendingUserMessage = Boolean(localPendingUserMessage);
  const pendingAuthorizations = getPendingAuthorizations(displayEvents);
  const isWaitingForAuthorization = pendingAuthorizations.length > 0;
  const isWaitingForInput = useMemo(
    () =>
      displayMessages.some((message) =>
        message.parts.some((part) => part.type === "dynamic-tool" && needsInputResponse(part)),
      ),
    [displayMessages],
  );
  const hasOpenTurn = useMemo(() => hasOpenChatTurn(displayEvents), [displayEvents]);
  const isBusy =
    isResuming ||
    hasLocalPendingUserMessage ||
    (!isWaitingForAuthorization &&
      !isWaitingForInput &&
      (hasOpenTurn || agent.status === "submitted" || agent.status === "streaming"));
  const isTurnBlocked = isBusy || isFinalizingTurn;

  useEffect(() => {
    if (sandboxContainerName || !hasOpenTurn) {
      return;
    }

    const chatIdForPoll = activeChatIdRef.current;

    if (!chatIdForPoll) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/chats/${encodeURIComponent(chatIdForPoll)}`);

        if (!response.ok || cancelled) {
          return;
        }

        const data = (await response.json()) as { readonly chat: ActiveChat | null };
        const nextSandboxContainerName = data.chat?.sandboxContainerName ?? null;

        if (cancelled || !nextSandboxContainerName) {
          return;
        }

        setPolledSandboxContainerName(nextSandboxContainerName);
        touchChat({
          id: chatIdForPoll,
          sandboxContainerName: nextSandboxContainerName,
          title: currentTitleRef.current,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Best-effort — the interval below retries.
      }
    };

    void poll();

    const interval = setInterval(() => void poll(), SANDBOX_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasOpenTurn, sandboxContainerName, touchChat]);

  const pendingMessage = pendingUserMessage
    ? createPendingUserMessage(displayChatId, pendingUserMessage)
    : null;
  const localPendingMessage = localPendingUserMessage
    ? createPendingUserMessage(
        displayChatId,
        localPendingUserMessage,
        "local-pending-user-message",
      )
    : null;
  const disabledReason = isWaitingForAuthorization
    ? getConnectionAuthorizationDisabledReason(pendingAuthorizations)
    : isFinalizingTurn
      ? "Finishing response."
    : undefined;
  const visibleMessages = appendPendingUserMessages(displayMessages, [
    pendingMessage,
    localPendingMessage,
  ]);
  const isEmpty =
    visibleMessages.length === 0 &&
    !isTurnBlocked &&
    !isWaitingForAuthorization;
  const isChatRoute = Boolean(shellActiveChatId || chatId);
  const showThinking =
    !isWaitingForAuthorization &&
    !isWaitingForInput &&
    (Boolean(pendingMessage || localPendingMessage) || hasOpenTurn || isTurnBlocked);
  const thinkingPresence = useThinkingPresence(showThinking);
  const displayError = clientError ?? agent.error?.message ?? null;
  const toastError = displayError && dismissedError !== displayError ? displayError : null;

  const resetSession = useCallback(() => {
    agent.reset();
    setActiveChatId(null);
    activeChatIdRef.current = null;
    eventIndexRef.current = 0;
    eventIndexChatIdRef.current = null;
    knownInitialEventsRef.current = [];
    setCurrentTitle("New chat");
    currentTitleRef.current = "New chat";
    resumeStartedRef.current = false;
    resumedEventsRef.current = [];
    streamEventsRef.current = [];
    streamEventKeysRef.current = new Set();
    localEventsRef.current = [];
    pendingEventBatchRef.current = [];
    if (eventFlushTimeoutRef.current !== undefined) {
      clearTimeout(eventFlushTimeoutRef.current);
      eventFlushTimeoutRef.current = undefined;
    }
    setResumedEvents([]);
    setStreamEvents([]);
    setLocalEvents([]);
    setPolledSandboxContainerName(null);
    stopFinalizingTurn();
    clearLocalPendingUserMessage();
    setIsResuming(false);
    setClientError(null);
  }, [agent, clearLocalPendingUserMessage, stopFinalizingTurn]);

  const prepareSend = useCallback(
    async (firstMessage: string) => {
      const limit = await checkSendLimitAction({ message: firstMessage });

      if (!limit.allowed) {
        setClientError(`${limit.message} Retry in ${limit.retryAfter}s.`);
        return false;
      }

      if (!activeChatIdRef.current) {
        const created = await createChatAction({ pendingUserMessage: firstMessage });

        touchChat({ ...created, status: "generating" });
        setActiveChatId(created.id);
        setShellActiveChatId(created.id);
        activeChatIdRef.current = created.id;
        eventIndexChatIdRef.current = created.id;
        eventIndexRef.current = 0;
        knownInitialEventsRef.current = [];
        setCurrentTitle(created.title);
        currentTitleRef.current = created.title;
        router.replace(`/chat/${created.id}`, { scroll: false });
      }

      return true;
    },
    [router, setShellActiveChatId, touchChat],
  );

  const sendMessage = useCallback(
    async (text: string, draftHandlers: DraftHandlers) => {
      const message = text.trim();

      if (!message || isTurnBlocked || localPendingUserMessageRef.current) {
        return;
      }

      const lengthError = getChatMessageLengthError(message);

      if (lengthError) {
        setClientError(lengthError);
        return;
      }

      if (isWaitingForAuthorization) {
        draftHandlers.restoreDraft(message);
        setClientError(disabledReason ?? "Connect the requested service before continuing.");
        return;
      }

      const showLocalPendingMessage = () => {
        setLocalPendingUserMessage(message);
        draftHandlers.clearDraft();
      };
      const restoreAfterFailedSend = (errorMessage?: string) => {
        clearLocalPendingUserMessage();
        draftHandlers.restoreDraft(message);

        if (errorMessage) {
          setClientError(errorMessage);
        }
      };
      let ready = false;

      setClientError(null);

      if (!isSetupReady) {
        setClientError("Finish the required Neon and Better Auth setup before chatting.");
        return;
      }

      if (!viewer) {
        requestSignIn(message);
        return;
      }

      resumedEventsRef.current = [];
      setResumedEvents([]);
      setIsResuming(false);
      showLocalPendingMessage();
      onPendingUserMessageSettled?.(message);

      try {
        ready = await prepareSend(message);
      } catch (error) {
        restoreAfterFailedSend(
          error instanceof Error ? error.message : "Failed to prepare chat.",
        );
        return;
      }

      if (!ready) {
        const chatId = activeChatIdRef.current;

        if (chatId) {
          void clearChatPendingMessageAction(chatId);
        }
        restoreAfterFailedSend();
        return;
      }

      const chatId = activeChatIdRef.current;

      if (!chatId) {
        restoreAfterFailedSend("Chat is still getting ready.");
        return;
      }

      try {
        const updated = await markChatPendingMessageAction({
          chatId,
          message,
        });
        touchChat({ ...updated, status: "generating" });
      } catch (error) {
        restoreAfterFailedSend(
          error instanceof Error ? error.message : "Failed to save pending message.",
        );
        return;
      }

      try {
        startFinalizingTurn();
        await agent.send({
          clientContext: createConnectionClientContext(enabledConnections),
          message,
        });
      } catch (error) {
        stopFinalizingTurn();
        void clearChatPendingMessageAction(chatId);

        if (isAbortError(error)) {
          clearLocalPendingUserMessage();
          onPendingUserMessageSettled?.();
          return;
        }

        restoreAfterFailedSend(error instanceof Error ? error.message : "Failed to send message.");
      }
    },
    [
      agent,
      clearLocalPendingUserMessage,
      disabledReason,
      enabledConnections,
      isSetupReady,
      isTurnBlocked,
      isWaitingForAuthorization,
      prepareSend,
      requestSignIn,
      setLocalPendingUserMessage,
      startFinalizingTurn,
      stopFinalizingTurn,
      onPendingUserMessageSettled,
      touchChat,
      viewer,
    ],
  );

  const handleInputResponses = useCallback(
    async (
      responses: readonly {
        readonly optionId?: string;
        readonly requestId: string;
        readonly text?: string;
      }[],
    ) => {
      if (isTurnBlocked) {
        return;
      }

      if (!viewer) {
        requestSignIn();
        return;
      }

      if (!activeChatIdRef.current) {
        setClientError("Start a chat before responding.");
        return;
      }

      const limit = await checkSendLimitAction();

      if (!limit.allowed) {
        setClientError(`${limit.message} Retry in ${limit.retryAfter}s.`);
        return;
      }

      try {
        startFinalizingTurn();
        await agent.send({ inputResponses: responses });
      } catch (error) {
        stopFinalizingTurn();
        setClientError(error instanceof Error ? error.message : "Failed to send response.");
      }
    },
    [agent, isTurnBlocked, requestSignIn, startFinalizingTurn, stopFinalizingTurn, viewer],
  );

  const handleSkipAuthorization = useCallback(
    async (authorization: PendingConnectionAuthorization) => {
      const chatId = activeChatIdRef.current;

      if (!viewer) {
        requestSignIn();
        return;
      }

      if (!chatId) {
        setClientError("Start a chat before skipping authorization.");
        return;
      }

      const events = createAuthorizationDeclinedEvents(
        authorization,
        persistedSessionRef.current?.state.continuationToken ?? "",
      );
      const persistedSession = persistedSessionRef.current;

      if (!persistedSession?.state.sessionId) {
        setClientError("Session is not ready to skip authorization.");
        return;
      }

      const previousSession = persistedSession.state;
      const nextSession = createInitialSessionState();

      agent.stop();
      persistedSession.setState(nextSession);

      const nextLocalEvents = mergeLocalEvents(localEventsRef.current, events);

      localEventsRef.current = nextLocalEvents;
      setLocalEvents(nextLocalEvents);
      setSkippingAuthorizationKey(authorization.key);
      setClientError(null);

      try {
        const result = await postSkipChatAuthorization(chatId, events, nextSession);
        const skippedEvents = mergeLocalEvents(displayEvents, events);

        eventIndexRef.current = Math.max(
          eventIndexRef.current,
          result.eventIndex + result.eventCount,
        );
        knownInitialEventsRef.current = skippedEvents;
        const nextStreamEvents = events.reduce<HandleMessageStreamEvent[]>(
          (mergedEvents, event) =>
            appendUniqueStreamEvent(mergedEvents, event, streamEventKeysRef.current),
          streamEventsRef.current,
        );

        streamEventsRef.current = nextStreamEvents;
        setStreamEvents(nextStreamEvents);
        localEventsRef.current = [];
        setLocalEvents([]);

        const nextSandboxContainerName = deriveSandboxContainerName(skippedEvents);

        touchChat({
          ...result.chat,
          sandboxContainerName: nextSandboxContainerName,
          status: "ready",
        });
        onActiveChatUpdated?.({
          events: skippedEvents,
          id: chatId,
          pendingUserMessage: null,
          sandboxContainerName: nextSandboxContainerName,
          session: nextSession,
          title: currentTitleRef.current,
        });
        onPendingUserMessageSettled?.();
      } catch (error) {
        if (previousSession) {
          persistedSessionRef.current?.setState(previousSession);
        }

        const eventKeys = new Set(events.map(getLocalEventKey).filter(Boolean));
        const revertedEvents = localEventsRef.current.filter((localEvent) => {
          const key = getLocalEventKey(localEvent);

          return !key || !eventKeys.has(key);
        });

        localEventsRef.current = revertedEvents;
        setLocalEvents(revertedEvents);
        setClientError(
          error instanceof Error ? error.message : "Failed to skip authorization.",
        );
      } finally {
        setSkippingAuthorizationKey(null);
      }
    },
    [
      agent,
      displayEvents,
      onActiveChatUpdated,
      onPendingUserMessageSettled,
      requestSignIn,
      touchChat,
      viewer,
    ],
  );

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      flushPendingChatEvents();
    };
  }, [flushPendingChatEvents]);

  useEffect(() => {
    const nextChatId = activeChat?.id ?? chatId ?? null;
    const nextTitle = activeChat?.title ?? "New chat";
    const nextEventIndex = activeChat?.events.length ?? 0;

    setActiveChatId(nextChatId);
    activeChatIdRef.current = nextChatId;
    if (eventIndexChatIdRef.current !== nextChatId) {
      eventIndexChatIdRef.current = nextChatId;
      eventIndexRef.current = nextEventIndex;
      knownInitialEventsRef.current = activeChat?.events ?? [];
      streamEventsRef.current = [];
      streamEventKeysRef.current = new Set();
      localEventsRef.current = [];
      pendingEventBatchRef.current = [];
      if (eventFlushTimeoutRef.current !== undefined) {
        clearTimeout(eventFlushTimeoutRef.current);
        eventFlushTimeoutRef.current = undefined;
      }
      setStreamEvents([]);
      setLocalEvents([]);
      setPolledSandboxContainerName(null);
      stopFinalizingTurn();
      clearLocalPendingUserMessage();
      if (activeChat?.session) {
        persistedSessionRef.current?.setState(activeChat.session);
      }
    } else if (!isTurnBlocked) {
      eventIndexRef.current = Math.max(eventIndexRef.current, nextEventIndex);
      if (activeChat) {
        knownInitialEventsRef.current = activeChat.events;
      }
      if (activeChat?.session?.sessionId && !persistedSessionRef.current?.state.sessionId) {
        persistedSessionRef.current?.setState(activeChat.session);
      }
    }
    setCurrentTitle(nextTitle);
    currentTitleRef.current = nextTitle;
  }, [
    activeChat?.events.length,
    activeChat?.id,
    activeChat?.session,
    activeChat?.title,
    chatId,
    clearLocalPendingUserMessage,
    isTurnBlocked,
    stopFinalizingTurn,
  ]);

  useEffect(() => {
    if (
      !viewer ||
      !activeChat?.session?.sessionId ||
      resumeStartedRef.current ||
      agent.status !== "ready"
    ) {
      return;
    }

    const abortController = new AbortController();
    resumeAbortControllerRef.current = abortController;
    const existingEvents = activeChat.events;
    const pendingMessageText = pendingUserMessage ?? null;
    const shouldResumeOpenTurn = hasOpenChatTurn(existingEvents);

    if (!pendingMessageText && !shouldResumeOpenTurn) {
      return;
    }

    const startIndex = existingEvents.length;
    const shouldIgnoreLeadingWaiting =
      pendingMessageText !== null &&
      !hasLatestUserMessage(
        reduceEventsToMessageData(existingEvents).messages,
        pendingMessageText,
      );
    const session = createPersistedClientSession({
      getEvents: () => [...existingEvents, ...resumedEventsRef.current],
      initialSession: activeChat.session,
      onSessionStarted: persistSessionState,
    });
    let cancelled = false;
    let completed = false;

    resumeStartedRef.current = true;
    resumedEventsRef.current = [];
    setResumedEvents([]);
    setIsResuming(true);
    setClientError(null);
    setResumeFailed(false);

    void (async () => {
      try {
        const resumeStreamOptions: StreamSessionOptions = {
          ignoreLeadingWaiting: shouldIgnoreLeadingWaiting,
          signal: abortController.signal,
          startIndex,
        };

        for await (const event of session.stream(resumeStreamOptions)) {
          if (cancelled || abortController.signal.aborted) {
            return;
          }

          const displayEvent = namespaceStreamEvent(
            event,
            activeChat.session?.sessionId,
          );
          const nextEvents = [...resumedEventsRef.current, displayEvent];
          resumedEventsRef.current = nextEvents;
          setResumedEvents(nextEvents);

          await postChatEvents(activeChat.id, [
            { event: displayEvent, eventIndex: startIndex + nextEvents.length - 1 },
          ]);

          if (isChatTurnSettledEvent(event)) {
            break;
          }
        }

        if (cancelled || abortController.signal.aborted) {
          return;
        }

        const newEvents = resumedEventsRef.current;
        const allEvents = [...existingEvents, ...newEvents];

        if (!newEvents.some(isChatTurnSettledEvent)) {
          setResumeFailed(true);
          touchChat({
            id: activeChat.id,
            status: "ended",
            title: currentTitleRef.current,
            updatedAt: new Date().toISOString(),
          });
          return;
        }

        await postChatSnapshot(activeChat.id, allEvents, session.state);
        eventIndexRef.current = allEvents.length;
        knownInitialEventsRef.current = allEvents;
        resumedEventsRef.current = [];
        setResumedEvents([]);

        const nextSandboxContainerName = deriveSandboxContainerName(allEvents);

        touchChat({
          id: activeChat.id,
          sandboxContainerName: nextSandboxContainerName,
          status: statusFromSettledEvents(allEvents),
          title: currentTitleRef.current,
          updatedAt: new Date().toISOString(),
        });
        onActiveChatUpdated?.({
          events: allEvents,
          id: activeChat.id,
          pendingUserMessage: null,
          sandboxContainerName: nextSandboxContainerName,
          session: session.state,
          title: currentTitleRef.current,
        });

        onPendingUserMessageSettled?.();
        completed = true;
      } catch (error) {
        if (!cancelled && !abortController.signal.aborted && !isAbortError(error)) {
          setResumeFailed(true);
          touchChat({
            id: activeChat.id,
            status: "ended",
            title: currentTitleRef.current,
            updatedAt: new Date().toISOString(),
          });
        }
      } finally {
        if (resumeAbortControllerRef.current === abortController) {
          resumeAbortControllerRef.current = null;
        }
        if (!cancelled && !abortController.signal.aborted) {
          setIsResuming(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (resumeAbortControllerRef.current === abortController) {
        resumeAbortControllerRef.current = null;
      }
      if (!completed) {
        resumeStartedRef.current = false;
      }
      abortController.abort();
    };
  }, [
    activeChat?.events,
    activeChat?.id,
    activeChat?.session,
    agent.status,
    onActiveChatUpdated,
    onPendingUserMessageSettled,
    pendingUserMessage,
    persistSessionState,
    retryTick,
    touchChat,
    viewer,
  ]);

  const handleRetryResume = useCallback(() => {
    setResumeFailed(false);
    resumeStartedRef.current = false;
    setRetryTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    const isLiveStreaming = agent.status === "submitted" || agent.status === "streaming";

    if (!isLiveStreaming) {
      lastLiveStreamProgressAtRef.current = null;
      return;
    }

    lastLiveStreamProgressAtRef.current ??= Date.now();

    const interval = window.setInterval(() => {
      const lastProgressAt = lastLiveStreamProgressAtRef.current;

      // A stalled live stream (backgrounded-tab throttling, a proxy holding
      // the socket open with no data) never errors and never progresses, so
      // agent.status sticks on "streaming" forever with no recovery path.
      // Reloading is what already works when a user manually refreshes: it
      // forces a fresh fetch of the chat, which by then has the complete
      // server-persisted turn (the durable run keeps going independent of
      // this browser tab's connection to it).
      if (lastProgressAt !== null && Date.now() - lastProgressAt >= STREAM_IDLE_TIMEOUT_MS) {
        window.location.reload();
      }
    }, LIVE_STREAM_WATCHDOG_POLL_MS);

    return () => window.clearInterval(interval);
  }, [agent.status]);

  useEffect(() => {
    currentTitleRef.current = currentTitle;
  }, [currentTitle]);

  useEffect(() => {
    setDismissedError(null);
  }, [displayError]);

  useEffect(() => {
    if (
      localPendingUserMessage &&
      hasLatestUserMessage(displayMessages, localPendingUserMessage)
    ) {
      clearLocalPendingUserMessage();
    }
  }, [clearLocalPendingUserMessage, displayMessages, localPendingUserMessage]);

  const handleStop = useCallback(() => {
    if (resumeAbortControllerRef.current) {
      resumeAbortControllerRef.current.abort();
      resumeAbortControllerRef.current = null;
    }

    agent.stop();
    stopFinalizingTurn();
    setIsResuming(false);
    clearLocalPendingUserMessage();
    onPendingUserMessageSettled?.();

    const chatId = activeChatIdRef.current;
    if (!chatId) {
      return;
    }

    void clearChatPendingMessageAction(chatId);

    const token = persistedSessionRef.current?.state.continuationToken ?? "";
    const waitingEvent = createSessionWaitingEvent(token);
    const nextLocalEvents = mergeLocalEvents(localEventsRef.current, [waitingEvent]);
    localEventsRef.current = nextLocalEvents;
    setLocalEvents(nextLocalEvents);

    const baseEvents =
      agent.events.length > 0
        ? mergeStreamEventLogs(activeChat?.events ?? [], agent.events)
        : displayEvents;
    const allEvents = mergeLocalEvents(baseEvents, [waitingEvent]);
    const nextSession = advanceSessionWithLocalEvents(
      persistedSessionRef.current?.state ?? createInitialSessionState(),
      [waitingEvent],
    );

    if (persistedSessionRef.current) {
      persistedSessionRef.current.setState(nextSession);
    }

    const nextSandboxContainerName = deriveSandboxContainerName(allEvents);
    touchChat({
      id: chatId,
      sandboxContainerName: nextSandboxContainerName,
      status: "ready",
      title: currentTitleRef.current,
      updatedAt: new Date().toISOString(),
    });

    onActiveChatUpdated?.({
      events: allEvents,
      id: chatId,
      pendingUserMessage: null,
      sandboxContainerName: nextSandboxContainerName,
      session: nextSession,
      title: currentTitleRef.current,
    });

    void postChatSnapshot(chatId, allEvents, nextSession).catch(() => {});
  }, [
    agent,
    clearLocalPendingUserMessage,
    displayEvents,
    onActiveChatUpdated,
    onPendingUserMessageSettled,
    stopFinalizingTurn,
    touchChat,
  ]);

  useEffect(() => {
    onControllerChange(
      {
        reset: resetSession,
        sendMessage,
        stop: handleStop,
      },
      {
        disabledReason,
        isBusy,
        isDisabled: !isSetupReady || isWaitingForAuthorization || isFinalizingTurn,
        isEmpty,
      },
    );
  }, [
    disabledReason,
    handleStop,
    isBusy,
    isFinalizingTurn,
    isEmpty,
    isSetupReady,
    isWaitingForAuthorization,
    onControllerChange,
    resetSession,
    sendMessage,
  ]);

  useEffect(() => {
    return () => {
      onControllerChange(null, IDLE_CONTROLLER_STATUS);
    };
  }, [onControllerChange]);

  return (
    <>
      {toastError ? (
        <ErrorToast
          message={toastError}
          onDismiss={() => setDismissedError(toastError)}
        />
      ) : null}

      {!toastError && providerNotice ? (
        <NoticeToast message={providerNotice} onDismiss={() => setProviderNotice(null)} />
      ) : null}

      {isEmpty && !activeChatId && !isChatRoute && emptyComposer ? (
        <EmptyChatBody composer={emptyComposer} />
      ) : (
        <>
          {isChatRoute ? (
            <SessionHeader
              containerName={sandboxContainerName}
              isRunning={isBusy}
            />
          ) : null}
          {isEmpty ? (
            <BlankChatBody />
          ) : (
            <ChatConversation>
              <ChatConversationContent>
                {visibleMessages.map((message, index) => (
                  <AgentMessage
                    canRespond={
                      (!isTurnBlocked || isWaitingForInput) &&
                      !isWaitingForAuthorization &&
                      Boolean(viewer) &&
                      isSetupReady
                    }
                    isStreaming={
                      agent.status === "streaming" && index === visibleMessages.length - 1
                    }
                    key={message.id}
                    message={message}
                    onInputResponses={handleInputResponses}
                  />
                ))}
                {pendingAuthorizations.map((authorization) => (
                  <ConnectionAuthorizationPrompt
                    authorization={authorization}
                    isSkipping={skippingAuthorizationKey === authorization.key}
                    key={authorization.key}
                    onSkip={handleSkipAuthorization}
                  />
                ))}
                {resumeFailed && !isResuming ? (
                  <TurnRetryPrompt onRetry={handleRetryResume} />
                ) : null}
                {thinkingPresence.shouldRender ? (
                  <ThinkingMessage
                    containerName={sandboxContainerName}
                    events={displayEvents}
                    isStreaming={isBusy}
                    isVisible={thinkingPresence.isVisible}
                  />
                ) : null}
              </ChatConversationContent>
              <ChatScrollButton />
            </ChatConversation>
          )}
        </>
      )}
    </>
  );
}

type PendingConnectionAuthorization = {
  readonly description: string;
  readonly displayName: string;
  readonly expiresAt?: string;
  readonly instructions?: string;
  readonly key: string;
  readonly name: string;
  readonly sequence: number;
  readonly stepIndex: number;
  readonly turnId: string;
  readonly url?: string;
  readonly authorization?: AuthorizationRequiredStreamEvent["data"]["authorization"];
};

function getPendingAuthorizations(events: readonly HandleMessageStreamEvent[]) {
  const pending = new Map<string, PendingConnectionAuthorization>();

  for (const event of events) {
    if (event.type === "authorization.required") {
      const authorization = toPendingAuthorization(event);
      pending.set(authorization.name, authorization);
      continue;
    }

    if (event.type === "authorization.completed") {
      pending.delete(event.data.name);
    }
  }

  return [...pending.values()];
}

function getConnectionAuthorizationDisabledReason(
  authorizations: readonly PendingConnectionAuthorization[],
) {
  const displayName = authorizations[0]?.displayName ?? "the requested service";

  return `Connect ${displayName} to continue this turn, or skip it.`;
}

function toPendingAuthorization(
  event: AuthorizationRequiredStreamEvent,
): PendingConnectionAuthorization {
  const challenge = event.data.authorization;
  const displayName = challenge?.displayName ?? event.data.name;

  return {
    authorization: challenge,
    description:
      challenge?.instructions ??
      event.data.description ??
      `Connect ${displayName} to let eve continue.`,
    displayName,
    expiresAt: challenge?.expiresAt,
    instructions: challenge?.instructions,
    key: `${event.data.turnId}:${event.data.name}`,
    name: event.data.name,
    sequence: event.data.sequence,
    stepIndex: event.data.stepIndex,
    turnId: event.data.turnId,
    url: challenge?.url,
  };
}

function ConnectionAuthorizationPrompt({
  authorization,
  isSkipping,
  onSkip,
}: {
  readonly authorization: PendingConnectionAuthorization;
  readonly isSkipping: boolean;
  readonly onSkip: (authorization: PendingConnectionAuthorization) => Promise<void>;
}) {
  return (
    <article aria-live="polite" className="flex w-full justify-start px-3">
      <div className="w-full max-w-md rounded-lg border border-border/70 bg-muted/20 p-3 text-sm shadow-sm">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <PlugIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Connect {authorization.displayName}</p>
            <p className="mt-1 text-muted-foreground">
              {authorization.description}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              {authorization.url ? (
                <Button asChild size="xs" type="button">
                  <a
                    href={authorization.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Connect
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </Button>
              ) : null}
              <Button
                disabled={isSkipping}
                onClick={() => {
                  void onSkip(authorization);
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {isSkipping ? "Skipping..." : "Skip"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function TurnRetryPrompt({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <article aria-live="polite" className="flex w-full justify-start px-3">
      <div className="w-full max-w-md rounded-lg border border-border/70 bg-muted/20 p-3 text-sm shadow-sm">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <RefreshCwIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">This reply didn't finish</p>
            <p className="mt-1 text-muted-foreground">
              The connection to the model was interrupted before it could respond. Try again?
            </p>
            <div className="mt-2.5">
              <Button onClick={onRetry} size="xs" type="button">
                Retry
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function createAuthorizationDeclinedEvents(
  authorization: PendingConnectionAuthorization,
  continuationToken: string,
): readonly HandleMessageStreamEvent[] {
  return [
    {
      data: {
        authorization: authorization.authorization,
        name: authorization.name,
        outcome: "declined",
        reason: "skipped",
        sequence: authorization.sequence,
        stepIndex: authorization.stepIndex,
        turnId: authorization.turnId,
      },
      type: "authorization.completed",
    },
    createSessionWaitingEvent(continuationToken),
  ];
}

// advanceBrowserSession (below) always resolves the real continuation token
// from session state, never from this event's `data.continuationToken` — the
// field only exists to satisfy eve's wire-protocol shape for a locally
// synthesized `session.waiting` event.
function createSessionWaitingEvent(continuationToken: string): HandleMessageStreamEvent {
  return {
    data: {
      continuationToken,
      wait: "next-user-message",
    },
    meta: {
      at: new Date().toISOString(),
    },
    type: "session.waiting",
  };
}

function advanceSessionWithLocalEvents(
  session: SessionState,
  events: readonly HandleMessageStreamEvent[],
) {
  if (events.length === 0 || !session.sessionId) {
    return session;
  }

  return advanceBrowserSession({
    baseStreamIndex: session.streamIndex,
    continuationToken: session.continuationToken,
    events,
    session,
    sessionId: session.sessionId,
  });
}

function mergeLocalEvents(
  events: readonly HandleMessageStreamEvent[],
  localEvents: readonly HandleMessageStreamEvent[],
): HandleMessageStreamEvent[] {
  const merged = [...events];

  if (localEvents.length === 0) {
    return merged;
  }

  const keys = new Set(events.map(getLocalEventKey).filter(Boolean));

  for (const event of localEvents) {
    const key = getLocalEventKey(event);

    if (!key || keys.has(key)) {
      continue;
    }

    keys.add(key);
    merged.push(event);
  }

  return merged;
}

function mergeStreamEventLogs(
  events: readonly HandleMessageStreamEvent[],
  streamedEvents: readonly HandleMessageStreamEvent[],
): HandleMessageStreamEvent[] {
  if (streamedEvents.length === 0) {
    return events as HandleMessageStreamEvent[];
  }

  let merged: HandleMessageStreamEvent[] = [...events];
  const seenKeys = new Set(merged.map(getStreamEventSignature));

  for (const event of streamedEvents) {
    const next = appendUniqueStreamEvent(merged, event, seenKeys);

    if (next !== merged) {
      merged = next;
    }
  }

  return merged;
}

function appendUniqueStreamEvent(
  events: readonly HandleMessageStreamEvent[],
  event: HandleMessageStreamEvent,
  seenKeys: Set<string>,
): HandleMessageStreamEvent[] {
  const key = getStreamEventSignature(event);

  if (seenKeys.has(key)) {
    return events as HandleMessageStreamEvent[];
  }

  seenKeys.add(key);

  return [...events, event];
}

function getStreamEventSignature(event: HandleMessageStreamEvent): string {
  return JSON.stringify(event);
}

function preserveKnownInitialEvents(
  snapshotEvents: readonly HandleMessageStreamEvent[],
  knownEvents: readonly HandleMessageStreamEvent[],
) {
  if (knownEvents.length === 0) {
    return snapshotEvents;
  }

  if (snapshotEvents.length === 0) {
    return knownEvents;
  }

  const sharedPrefixLength = countSharedEventPrefix(snapshotEvents, knownEvents);

  if (sharedPrefixLength === knownEvents.length) {
    return snapshotEvents;
  }

  if (sharedPrefixLength === snapshotEvents.length) {
    return knownEvents;
  }

  if (sharedPrefixLength > 0) {
    return [...knownEvents, ...snapshotEvents.slice(sharedPrefixLength)];
  }

  return [...knownEvents, ...snapshotEvents];
}

function countSharedEventPrefix(
  events: readonly HandleMessageStreamEvent[],
  knownEvents: readonly HandleMessageStreamEvent[],
) {
  const count = Math.min(events.length, knownEvents.length);

  for (let index = 0; index < count; index += 1) {
    if (!areSameStreamEvent(knownEvents[index]!, events[index])) {
      return index;
    }
  }

  return count;
}

function areSameStreamEvent(
  left: HandleMessageStreamEvent,
  right: HandleMessageStreamEvent | undefined,
) {
  return right !== undefined && areEqualJsonValues(left, right);
}

function areEqualJsonValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => areEqualJsonValues(item, right[index]));
  }

  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      areEqualJsonValues(leftRecord[key], rightRecord[key]),
  );
}

function getLocalEventKey(event: HandleMessageStreamEvent) {
  if (event.type === "authorization.completed") {
    return `${event.type}:${event.data.turnId}:${event.data.name}:${event.data.outcome}:${event.data.reason ?? ""}`;
  }

  if (event.type === "session.waiting") {
    return `${event.type}:${event.meta?.at ?? "local"}`;
  }

  return null;
}

function appendPendingUserMessages(
  messages: readonly EveMessageData["messages"][number][],
  pendingMessages: readonly (EveMessage | null)[],
) {
  let nextMessages = messages;

  for (const pendingMessage of pendingMessages) {
    const pendingText = pendingMessage ? getMessageText(pendingMessage) : null;

    if (!pendingMessage || !pendingText || hasLatestUserMessage(nextMessages, pendingText)) {
      continue;
    }

    nextMessages = [...nextMessages, pendingMessage];
  }

  return nextMessages;
}

function createPendingUserMessage(
  chatId: string,
  text: string,
  idSuffix = "pending-user-message",
): EveMessage {
  return {
    id: `${chatId}:${idSuffix}`,
    metadata: {
      optimistic: true,
      status: "submitted",
    },
    parts: [
      {
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "user",
  };
}

function usePendingUserMessage() {
  const [message, setMessageState] = useState<string | null>(null);
  const messageRef = useRef<string | null>(null);

  const setMessage = useCallback((nextMessage: string | null) => {
    messageRef.current = nextMessage;
    setMessageState(nextMessage);
  }, []);

  const clearMessage = useCallback(() => {
    setMessage(null);
  }, [setMessage]);

  return { clearMessage, message, messageRef, setMessage };
}

const CONNECTION_LABELS = {
  linear: "Linear",
  notion: "Notion",
  sentry: "Sentry",
  atlassian: "Atlassian",
  shortcut: "Shortcut",
} satisfies Record<keyof EnabledConnections, string>;

function createConnectionClientContext(enabledConnections: EnabledConnections) {
  const entries = Object.entries(CONNECTION_LABELS) as [
    keyof EnabledConnections,
    string,
  ][];
  const enabled = entries
    .filter(([connection]) => enabledConnections[connection])
    .map(([, label]) => label);
  const disabled = entries
    .filter(([connection]) => !enabledConnections[connection])
    .map(([, label]) => label);

  if (enabled.length > 0) {
    const disabledContext =
      disabled.length > 0
        ? ` Do not use disabled connections unless the user enables them first: ${disabled.join(", ")}.`
        : "";

    return `The user has enabled these external connections for this turn: ${enabled.join(", ")}. Use an enabled connection when it is relevant to the user's request.${disabledContext}`;
  }

  return "The user has disabled all external connections for this turn. Do not search or call connection tools unless the user enables a connection first.";
}

function useThinkingPresence(active: boolean) {
  const [shouldRender, setShouldRender] = useState(active);
  const [isVisible, setIsVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setShouldRender(true);

      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    setIsVisible(false);

    const timeout = window.setTimeout(() => {
      setShouldRender(false);
    }, THINKING_EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [active]);

  return { isVisible, shouldRender };
}

function ThinkingMessage({
  containerName,
  events,
  isStreaming = false,
  isVisible,
}: {
  readonly containerName?: string | null;
  readonly events: readonly HandleMessageStreamEvent[];
  readonly isStreaming?: boolean;
  readonly isVisible: boolean;
}) {
  return (
    <article
      aria-live={isVisible ? "polite" : "off"}
      className={[
        "flex w-full justify-start overflow-hidden px-3 transition-[opacity,transform] duration-200 ease-out",
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0 pointer-events-none",
      ].join(" ")}
      role="status"
    >
      <TaskProgressIndicator
        containerName={containerName}
        events={events}
        isStreaming={isStreaming}
      />
    </article>
  );
}

function SessionHeader({
  containerName,
  isRunning = false,
}: {
  readonly containerName: string | null;
  readonly isRunning?: boolean;
}) {
  if (!containerName) {
    return <div className="h-12 shrink-0" />;
  }

  // Undocumented: the VS Code team has confirmed `code --folder-uri
  // vscode-remote://attached-container+<name>/<path>` attaches to an already
  // running container (github.com/microsoft/vscode-remote-release#5867), but
  // called it "not officially supported." This is the equivalent clickable
  // vscode:// deep link. If it doesn't open VS Code on your machine, use
  // "Dev Containers: Attach to Running Container..." from the command
  // palette instead, and paste the container name from a `docker ps`.
  const vsCodeAttachHref = `vscode://vscode-remote/attached-container+${encodeURIComponent(containerName)}/workspace`;

  // pt-14/md:pt-8 mirrors EmptyChatBody's offset — it clears the shell's
  // absolutely-positioned top bar (share button, sidebar toggle) so this
  // button renders just below it instead of overlapping in the same corner.
  return (
    <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pt-14 pb-2 md:pt-8">
      <SandboxTelemetryBadge containerName={containerName} isRunning={isRunning} />
      {!containerName.startsWith("hv:") ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              aria-label="Open in VS Code"
              className="text-muted-foreground hover:text-foreground"
              size="icon-sm"
              variant="ghost"
            >
              <a href={vsCodeAttachHref}>
                <ExternalLinkIcon className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Open <span className="font-mono">{containerName}</span> in VS Code — unofficial deep
            link, requires the Dev Containers extension
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function BlankChatBody() {
  return <div className="min-h-0 flex-1" />;
}

export function EmptyChatBody({ composer }: { readonly composer?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-14 md:pt-8">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full max-w-2xl space-y-8 sm:space-y-10 md:space-y-12">
          <h1 className="flex justify-center">
            <img
              alt="eve"
              className="size-16 select-none invert sm:size-20 md:size-24 dark:invert-0"
              draggable={false}
              src="/eve.svg"
            />
          </h1>
          {composer}
        </div>
      </div>
    </div>
  );
}

export function ErrorToast({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      aria-live="assertive"
      className="fixed top-3 right-3 z-50 flex w-[calc(100vw-1.5rem)] max-w-sm items-start gap-3 rounded-md border border-destructive/30 bg-background/95 p-3 text-sm shadow-lg backdrop-blur sm:top-4 sm:right-4"
      role="alert"
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Request failed</p>
        <p className="mt-0.5 text-muted-foreground">{message}</p>
      </div>
      <Button
        aria-label="Dismiss error"
        className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

export function NoticeToast({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className="fixed top-3 right-3 z-50 flex w-[calc(100vw-1.5rem)] max-w-sm items-start gap-3 rounded-md border border-border bg-background/95 p-3 text-sm shadow-lg backdrop-blur sm:top-4 sm:right-4"
      role="status"
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground">{message}</p>
      </div>
      <Button
        aria-label="Dismiss notice"
        className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

export function ComposerFooterControls({
  setupStatus,
}: {
  readonly setupStatus: SetupStatus;
}) {
  const { enabledConnections, setConnectionEnabled } = useChatShell();

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
      <ComposerHint setupStatus={setupStatus} />
      <IntegrationsMenu
        enabledConnections={enabledConnections}
        onConnectionEnabledChange={setConnectionEnabled}
        setupStatus={setupStatus}
      />
    </div>
  );
}

function ComposerHint({ setupStatus }: { readonly setupStatus: SetupStatus }) {
  if (!setupStatus.appReady) {
    const reason = getSetupRequiredReason(setupStatus);

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-md px-2 text-[15px] text-muted-foreground/50"
            tabIndex={0}
          >
            <LockIcon className="size-3.5 shrink-0" />
            <span className="truncate">Setup required</span>
            <ChevronDownIcon className="size-3.5 shrink-0" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{reason}</TooltipContent>
      </Tooltip>
    );
  }

  return null;
}

function getSetupRequiredReason(setupStatus: SetupStatus) {
  if (!setupStatus.databaseConfigured) {
    return "Connect Neon Postgres before chatting.";
  }

  if (!setupStatus.databaseSchemaReady) {
    return "Run database migrations before chatting.";
  }

  if (!setupStatus.authReady) {
    return setupStatus.missing.length
      ? `Finish auth setup. Missing: ${setupStatus.missing.join(", ")}.`
      : "Finish auth setup before chatting.";
  }

  if (!setupStatus.rateLimitReady) {
    return "Provision Upstash Redis before chatting.";
  }

  return "Finish setup before chatting.";
}

function hasLatestUserMessage(
  messages: readonly EveMessageData["messages"][number][],
  text: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "user") {
      continue;
    }

    return getMessageText(message) === text.trim();
  }

  return false;
}

function getMessageText(message: EveMessageData["messages"][number]) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text || null;
}
