/**
 * End-to-end demo flow script for eve-chat-template
 * Exercises:
 * 1. Initial plan & tool execution (get_employee_rewards)
 * 2. Interactive HITL pause (ask_question)
 * 3. Continuation via inputResponses (simulate_pension_change)
 *
 * Run with: node scripts/demo-flow.mjs
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function* readNdjsonStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          yield JSON.parse(line);
        } catch {
          // ignore partial json
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }

  const line = buffer.trim();
  if (line.length > 0) {
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

async function runDemoFlow() {
  console.log("=================================================");
  console.log("🚀 Starting eve Interactive HITL Demo Flow");
  console.log(`📡 Endpoint: ${BASE_URL}/eve/v1/session`);
  console.log("=================================================\n");

  // Step 1: Start session with initial prompt
  console.log("▶ Step 1: Sending prompt 'Demo with a tool call'...\n");
  const initRes = await fetch(`${BASE_URL}/eve/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Demo with a tool call" }),
  });

  if (!initRes.ok) {
    throw new Error(`Failed to initialize session: ${initRes.status} ${await initRes.text()}`);
  }

  const { sessionId } = await initRes.json();
  console.log(`✅ Session opened: ${sessionId}`);
  console.log("▶ Streaming turn events from assistant...\n");

  const streamRes = await fetch(`${BASE_URL}/eve/v1/session/${encodeURIComponent(sessionId)}/stream`);
  if (!streamRes.ok) {
    throw new Error(`Failed to stream session: ${streamRes.status} ${await streamRes.text()}`);
  }

  let continuationToken = null;
  let pendingInputRequest = null;
  let streamIndex = 0;

  for await (const event of readNdjsonStream(streamRes)) {
    streamIndex += 1;

    if (event.type === "turn.started") {
      process.stdout.write("💬 Assistant: ");
    } else if (event.type === "message.delta" && event.data?.delta) {
      process.stdout.write(event.data.delta);
    } else if (event.type === "tool.started") {
      console.log(`\n\n🔧 [Tool Called]: ${event.data?.name || "tool"}`);
    } else if (event.type === "tool.completed") {
      console.log(`✨ [Tool Result]: ${event.data?.name || "tool"} finished successfully.`);
    } else if (event.type === "input.requested") {
      pendingInputRequest = event.data?.requests?.[0] || event.data;
      console.log("\n\n⏸ [Interactive HITL Pause Triggered]");
      console.log(`❓ Prompt: ${pendingInputRequest?.prompt || JSON.stringify(pendingInputRequest)}`);
      if (pendingInputRequest?.options) {
        console.log("📋 Available Options:");
        for (const opt of pendingInputRequest.options) {
          console.log(`   • [${opt.id}] ${opt.label} (${opt.description || ""})`);
        }
      }
    } else if (event.type === "session.waiting") {
      continuationToken = event.data?.continuationToken || continuationToken;
      console.log(`\n⏳ Session Waiting. Continuation Token: ${continuationToken ? "Acquired" : "None"}`);
      break;
    }
  }

  if (!pendingInputRequest) {
    console.log("⚠️ No input request was paused. Demo flow ended early.");
    return;
  }

  // Step 2: Answer the interactive prompt
  const chosenOptionId = pendingInputRequest.options?.[0]?.id || "pension_opt";
  const requestId = pendingInputRequest.requestId;

  console.log(`\n▶ Step 2: Selecting Option [${chosenOptionId}] via inputResponses...\n`);

  const responseBody = {
    inputResponses: [{ requestId, optionId: chosenOptionId }],
    continuationToken,
  };

  const contRes = await fetch(`${BASE_URL}/eve/v1/session/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  });

  if (!contRes.ok) {
    throw new Error(`Continuation failed: ${contRes.status} ${await contRes.text()}`);
  }

  console.log("✅ Continuation accepted by eve runtime!");
  console.log("▶ Step 3: Streaming final synthesized answer...\n");

  const contStreamRes = await fetch(
    `${BASE_URL}/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=${streamIndex}`,
  );

  if (!contStreamRes.ok) {
    throw new Error(`Continuation stream failed: ${contStreamRes.status}`);
  }

  for await (const event of readNdjsonStream(contStreamRes)) {
    if (event.type === "message.delta" && event.data?.delta) {
      process.stdout.write(event.data.delta);
    } else if (event.type === "tool.started") {
      console.log(`\n\n🔧 [Tool Called]: ${event.data?.name || "tool"}`);
    } else if (event.type === "tool.completed") {
      console.log(`✨ [Tool Result]: ${event.data?.name || "tool"} finished.`);
    } else if (event.type === "session.waiting" || event.type === "turn.completed") {
      console.log("\n\n🏁 [Turn Completed]: Demo flow finished cleanly!");
      break;
    }
  }

  console.log("\n=================================================");
  console.log("🎉 Interactive HITL Demo Flow Completed Successfully!");
  console.log("=================================================\n");
}

runDemoFlow().catch((err) => {
  console.error("❌ Demo flow encountered an error:", err);
  process.exit(1);
});
