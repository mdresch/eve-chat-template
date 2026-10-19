import type { HandleMessageStreamEvent } from "eve/client";

export function isChatTurnSettledEvent(event: HandleMessageStreamEvent) {
  return (
    event.type === "authorization.required" ||
    event.type === "session.completed" ||
    event.type === "session.failed" ||
    event.type === "session.waiting" ||
    event.type === "turn.completed" ||
    event.type === "turn.failed"
  );
}

export function isStreamTurnBoundaryEvent(event: HandleMessageStreamEvent) {
  return (
    event.type === "authorization.required" ||
    event.type === "session.completed" ||
    event.type === "session.failed" ||
    event.type === "session.waiting"
  );
}

export function extractContinuationTokenFromEvents(
  events: readonly HandleMessageStreamEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (
      event &&
      event.type === "session.waiting" &&
      "data" in event &&
      typeof event.data === "object" &&
      event.data &&
      "continuationToken" in event.data &&
      typeof event.data.continuationToken === "string" &&
      event.data.continuationToken.length > 0
    ) {
      return event.data.continuationToken;
    }
  }

  return undefined;
}

export function extractSessionIdFromEvents(
  events: readonly HandleMessageStreamEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (!event) {
      continue;
    }

    if ("sessionId" in event && typeof event.sessionId === "string" && event.sessionId.length > 0) {
      return event.sessionId;
    }

    if ("data" in event && typeof event.data === "object" && event.data) {
      if ("sessionId" in event.data && typeof event.data.sessionId === "string" && event.data.sessionId.length > 0) {
        return event.data.sessionId;
      }

      if ("turnId" in event.data && typeof event.data.turnId === "string" && event.data.turnId.length > 0) {
        const [possibleSessionId] = event.data.turnId.split(":");
        if (possibleSessionId?.startsWith("wrun_")) {
          return possibleSessionId;
        }
      }
    }
  }

  return undefined;
}

