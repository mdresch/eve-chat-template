"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import {
  deleteProviderCredentialAction,
  listModelsForProviderAction,
  listModelsForStoredProviderAction,
  saveProviderCredentialAction,
  setActiveProviderAction,
  testAzureCredentialAction,
  testStoredProviderCredentialAction,
} from "@/app/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BASE_URL_PROVIDERS, type AiProvider } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import type { ProviderModelOption } from "@/lib/provider-models";

type CredentialSummary = {
  readonly provider: AiProvider;
  readonly model: string | null;
  readonly azureResourceName: string | null;
  readonly azureApiVersion: string | null;
  readonly baseUrl: string | null;
  readonly updatedAt: Date;
};

const PROVIDER_LABELS: Record<AiProvider, string> = {
  "ai-gateway": "Vercel AI Gateway",
  anthropic: "Anthropic",
  azure: "Azure AI Foundry",
  google: "Google Gemini",
  mistral: "Mistral",
  ollama: "Ollama",
  "foundry-local": "Microsoft Foundry Local",
  bifrost: "Bifrost Gateway",
  "merge-gateway": "Merge Gateway",
};

const LOCAL_PROVIDERS = new Set<AiProvider>(["ollama", "foundry-local"]);
const DEFAULT_LOCAL_BASE_URL: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  "foundry-local": "http://localhost:5273/v1",
  "ai-gateway": "https://ai-gateway.vercel.sh/v1",
};

export function ModelSettingsForm({
  activeProvider: initialActiveProvider,
  credentials: initialCredentials,
}: {
  readonly activeProvider: AiProvider | null;
  readonly credentials: readonly CredentialSummary[];
}) {
  const [activeProvider, setActiveProviderState] = useState(initialActiveProvider);
  const [credentials, setCredentials] = useState(initialCredentials);
  const [openDialog, setOpenDialog] = useState<AiProvider | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: AiProvider; ok: boolean; message: string } | null>(
    null,
  );

  const credentialFor = (provider: AiProvider) => credentials.find((c) => c.provider === provider) ?? null;

  async function handleUseDefault() {
    setBusyProvider("default");

    try {
      await setActiveProviderAction(null);
      setActiveProviderState(null);
    } catch (error) {
      setTestResult({
        message: error instanceof Error ? error.message : "Failed to switch to default.",
        ok: false,
        provider: "anthropic",
      });
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleUseProvider(provider: AiProvider) {
    setBusyProvider(provider);

    try {
      await setActiveProviderAction(provider);
      setActiveProviderState(provider);
    } catch (error) {
      setTestResult({
        message: error instanceof Error ? error.message : "Failed to activate provider.",
        ok: false,
        provider,
      });
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleTest(provider: AiProvider) {
    setBusyProvider(provider);
    setTestResult(null);

    try {
      await testStoredProviderCredentialAction(provider);
      setTestResult({ message: "Connection succeeded.", ok: true, provider });
    } catch (error) {
      setTestResult({
        message: error instanceof Error ? error.message : "Test failed.",
        ok: false,
        provider,
      });
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleRemove(provider: AiProvider) {
    setBusyProvider(provider);

    try {
      await deleteProviderCredentialAction(provider);
      setCredentials((prev) => prev.filter((c) => c.provider !== provider));

      if (activeProvider === provider) {
        setActiveProviderState(null);
      }
    } catch (error) {
      setTestResult({
        message: error instanceof Error ? error.message : "Failed to remove.",
        ok: false,
        provider,
      });
    } finally {
      setBusyProvider(null);
    }
  }

  function handleSaved(summary: CredentialSummary) {
    setCredentials((prev) => [...prev.filter((c) => c.provider !== summary.provider), summary]);
    setActiveProviderState(summary.provider);
    setOpenDialog(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">AI provider</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which model your chats use. Configure a provider with your own API key, or stick with
          the default — no key required.
        </p>
      </div>

      <ProviderCard
        active={activeProvider === null}
        busy={busyProvider === "default"}
        description="Uses the built-in model. No API key required."
        title="Default"
      >
        {activeProvider === null ? (
          <Badge>Active</Badge>
        ) : (
          <Button disabled={busyProvider !== null} onClick={handleUseDefault} size="sm" variant="outline">
            Use this
          </Button>
        )}
      </ProviderCard>

      {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((provider) => {
        const credential = credentialFor(provider);
        const isActive = activeProvider === provider;
        const isBusy = busyProvider === provider;

        return (
          <ProviderCard
            active={isActive}
            busy={isBusy}
            description={describeCredential(provider, credential)}
            key={provider}
            title={PROVIDER_LABELS[provider]}
          >
            <div className="flex flex-wrap items-center gap-2">
              {isActive ? <Badge>Active</Badge> : null}
              {credential ? (
                <>
                  {!isActive ? (
                    <Button
                      disabled={busyProvider !== null}
                      onClick={() => void handleUseProvider(provider)}
                      size="sm"
                      variant="outline"
                    >
                      Use this
                    </Button>
                  ) : null}
                  <Button
                    disabled={busyProvider !== null}
                    onClick={() => void handleTest(provider)}
                    size="sm"
                    variant="ghost"
                  >
                    {isBusy ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                    Test
                  </Button>
                  <Button
                    disabled={busyProvider !== null}
                    onClick={() => setOpenDialog(provider)}
                    size="sm"
                    variant="ghost"
                  >
                    Edit
                  </Button>
                  <Button
                    disabled={busyProvider !== null}
                    onClick={() => void handleRemove(provider)}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Button
                  disabled={busyProvider !== null}
                  onClick={() => setOpenDialog(provider)}
                  size="sm"
                  variant="outline"
                >
                  Configure
                </Button>
              )}
            </div>
            {testResult?.provider === provider ? (
              <p className={cn("mt-2 text-xs", testResult.ok ? "text-emerald-600" : "text-destructive")}>
                {testResult.message}
              </p>
            ) : null}
          </ProviderCard>
        );
      })}

      {openDialog ? (
        <ConfigureDialog
          existingCredential={credentialFor(openDialog)}
          onClose={() => setOpenDialog(null)}
          onSaved={handleSaved}
          provider={openDialog}
        />
      ) : null}
    </div>
  );
}

function ProviderCard({
  active,
  busy,
  children,
  description,
  title,
}: {
  readonly active: boolean;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        active ? "border-primary/40 bg-primary/5" : "border-border",
        busy && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

function describeCredential(provider: AiProvider, credential: CredentialSummary | null) {
  if (!credential) {
    if (provider === "ai-gateway") {
      return "Route agent model requests through Vercel AI Gateway (ai-gateway.vercel.sh/v1). Not configured yet.";
    }
    return LOCAL_PROVIDERS.has(provider)
      ? "Runs locally. Not configured yet."
      : "Bring your own API key. Not configured yet.";
  }

  if (provider === "azure") {
    return `${credential.azureResourceName} / ${credential.model}`;
  }

  if (provider === "bifrost" && credential.baseUrl) {
    return `${credential.baseUrl} · ${credential.model ?? "Configured"}`;
  }

  if (provider === "merge-gateway" && credential.baseUrl) {
    return `${credential.baseUrl} · ${credential.model ?? "Configured"}`;
  }

  if (provider === "ai-gateway") {
    return `${credential.baseUrl ?? "https://ai-gateway.vercel.sh/v1"} · ${credential.model ?? "openai/gpt-6-astra"}`;
  }

  return credential.model ?? "Configured";
}

function ConfigureDialog({
  existingCredential,
  onClose,
  onSaved,
  provider,
}: {
  readonly existingCredential: CredentialSummary | null;
  readonly onClose: () => void;
  readonly onSaved: (summary: CredentialSummary) => void;
  readonly provider: AiProvider;
}) {
  const isAzure = provider === "azure";
  const isAiGateway = provider === "ai-gateway";
  const isLocal = LOCAL_PROVIDERS.has(provider);
  // Base URL field applies more broadly than "runs locally" (e.g. a self-hosted
  // Bifrost gateway isn't local, but still needs an endpoint to point at).
  const showsBaseUrl = BASE_URL_PROVIDERS.includes(provider);
  const isEditing = existingCredential !== null;

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    existingCredential?.baseUrl ?? DEFAULT_LOCAL_BASE_URL[provider] ?? "",
  );
  const [azureResourceName, setAzureResourceName] = useState(
    existingCredential?.azureResourceName ?? "",
  );
  const [azureDeploymentName, setAzureDeploymentName] = useState(
    isAzure ? (existingCredential?.model ?? "") : "",
  );
  const [azureApiVersion, setAzureApiVersion] = useState(existingCredential?.azureApiVersion ?? "");
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(
    !isAzure
      ? (existingCredential?.model ?? (isAiGateway ? "openai/gpt-5-mini" : ""))
      : "",
  );
  const [status, setStatus] = useState<{ message: string; ok: boolean } | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [azureTested, setAzureTested] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleFetchModels() {
    setIsFetching(true);
    setStatus(null);

    try {
      const nonAzureProvider = provider as Exclude<AiProvider, "azure">;
      // Reuse the already-stored key when editing without retyping it (cloud providers only —
      // local providers' base URL is plain text and editable, so there's nothing to "keep").
      const result =
        isEditing && !apiKey && !isLocal
          ? await listModelsForStoredProviderAction(nonAzureProvider)
          : await listModelsForProviderAction(nonAzureProvider, {
              apiKey: apiKey || undefined,
              baseUrl: showsBaseUrl ? baseUrl : undefined,
            });

      setModels(result);
      setSelectedModel((current) => (result.some((m) => m.id === current) ? current : (result[0]?.id ?? "")));

      if (result.length === 0) {
        setStatus({ message: "No models were returned.", ok: false });
      }
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Failed to fetch models.", ok: false });
    } finally {
      setIsFetching(false);
    }
  }

  async function handleTestAzure() {
    setIsTesting(true);
    setStatus(null);

    try {
      if (isEditing && !apiKey) {
        await testStoredProviderCredentialAction("azure");
      } else {
        await testAzureCredentialAction({
          apiKey,
          apiVersion: azureApiVersion || undefined,
          deploymentName: azureDeploymentName,
          resourceName: azureResourceName,
        });
      }
      setAzureTested(true);
      setStatus({ message: "Connection succeeded.", ok: true });
    } catch (error) {
      setAzureTested(false);
      setStatus({ message: error instanceof Error ? error.message : "Test failed.", ok: false });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setStatus(null);

    try {
      await saveProviderCredentialAction({
        apiKey: apiKey || undefined,
        azureApiVersion: isAzure ? azureApiVersion || undefined : undefined,
        azureResourceName: isAzure ? azureResourceName : undefined,
        baseUrl: showsBaseUrl ? baseUrl : undefined,
        model: isAzure ? azureDeploymentName : selectedModel,
        provider,
      });

      onSaved({
        azureApiVersion: isAzure ? azureApiVersion || null : null,
        azureResourceName: isAzure ? azureResourceName : null,
        baseUrl: showsBaseUrl ? baseUrl : null,
        model: isAzure ? azureDeploymentName : selectedModel,
        provider,
        updatedAt: new Date(),
      });
    } catch (error) {
      setStatus({ message: error instanceof Error ? error.message : "Failed to save.", ok: false });
    } finally {
      setIsSaving(false);
    }
  }

  const canSave = isAzure
    ? azureTested && Boolean(azureResourceName) && Boolean(azureDeploymentName)
    : Boolean(selectedModel);

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className={cn(isAiGateway && "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit" : "Configure"} {PROVIDER_LABELS[provider]}
          </DialogTitle>
          <DialogDescription>
            {isLocal
              ? "This only works while the app itself runs locally (pnpm dev) on the same machine as the server. It will fail once deployed."
              : isEditing
                ? "Leave the API key blank to keep the one already saved — it's never shown again once saved."
                : "Your key is encrypted and never shown again once saved."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {isAiGateway ? (
            <div className="rounded-md border border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">
                Route a coding agent through{" "}
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://vercel.com/docs/ai-gateway/getting-started#route-a-coding-agent-through-ai-gateway"
                  rel="noreferrer"
                  target="_blank"
                >
                  Vercel AI Gateway
                </a>
              </p>
              <p>
                Connect local coding agents (such as Claude Code) via the Vercel CLI, or create an{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">AI_GATEWAY_API_KEY</code>:
              </p>
              <pre className="overflow-x-auto rounded bg-background/80 px-2.5 py-1.5 font-mono text-[11px] text-foreground border border-border/60">
                npx vercel@latest ai-gateway setup
              </pre>
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys%3FshowCreateKeyModal%3Dtrue&title=AI+Gateway+API+Keys"
                  rel="noreferrer"
                  target="_blank"
                >
                  Create API Key
                </a>
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://vercel.com/ai-gateway/models?freeTier=true"
                  rel="noreferrer"
                  target="_blank"
                >
                  Free-tier models
                </a>
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Flogs&title=AI+Gateway+Logs"
                  rel="noreferrer"
                  target="_blank"
                >
                  AI Gateway Logs
                </a>
                <a
                  className="underline underline-offset-2 hover:text-foreground"
                  href="https://vercel.com/docs/ai-gateway/coding-agents"
                  rel="noreferrer"
                  target="_blank"
                >
                  Coding Agents docs
                </a>
              </div>
            </div>
          ) : null}

          {showsBaseUrl ? (
            <Field label="Base URL">
              <Input
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={DEFAULT_LOCAL_BASE_URL[provider] ?? "https://your-bifrost-host/v1"}
                value={baseUrl}
              />
            </Field>
          ) : null}

          {isAzure ? (
            <>
              <Field label="Resource name">
                <Input
                  onChange={(event) => setAzureResourceName(event.target.value)}
                  value={azureResourceName}
                />
              </Field>
              <Field label="Deployment name">
                <Input
                  onChange={(event) => setAzureDeploymentName(event.target.value)}
                  value={azureDeploymentName}
                />
              </Field>
              <Field label="API version (optional)">
                <Input
                  onChange={(event) => setAzureApiVersion(event.target.value)}
                  placeholder="2024-10-21"
                  value={azureApiVersion}
                />
              </Field>
            </>
          ) : null}

          <Field
            label={
              isLocal
                ? "API key (optional)"
                : isEditing
                  ? "API key (leave blank to keep current)"
                  : isAiGateway
                    ? "AI_GATEWAY_API_KEY (or leave blank if exported in environment)"
                    : "API key"
            }
          >
            <Input
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              name={`${provider}-api-key`}
              onChange={(event) => {
                setApiKey(event.target.value);
                setAzureTested(false);
              }}
              placeholder={isAiGateway ? "vck_..." : undefined}
              type="password"
              value={apiKey}
            />
          </Field>

          {isAiGateway ? (
            <Field label="Model slug (or click Fetch models below)">
              <Input
                onChange={(event) => setSelectedModel(event.target.value)}
                placeholder="openai/gpt-6-astra"
                value={selectedModel}
              />
            </Field>
          ) : null}

          {!isAzure ? (
            <div className="flex items-center gap-2">
              <Button disabled={isFetching} onClick={() => void handleFetchModels()} size="sm" type="button">
                {isFetching ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                Fetch models
              </Button>
              {models.length > 0 ? (
                <Select onValueChange={setSelectedModel} value={selectedModel}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                        {formatTokenLimits(model) ? (
                          <span className="text-muted-foreground"> — {formatTokenLimits(model)}</span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : (
            <Button disabled={isTesting} onClick={() => void handleTestAzure()} size="sm" type="button">
              {isTesting ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {azureTested ? <CheckIcon className="size-3.5" /> : null}
              Test connection
            </Button>
          )}

          {status ? (
            <p className={cn("text-xs", status.ok ? "text-emerald-600" : "text-destructive")}>
              {status.message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={!canSave || isSaving} onClick={() => void handleSave()} type="button">
            {isSaving ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            Save & use
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatTokenLimits(model: ProviderModelOption) {
  const parts: string[] = [];

  if (model.inputTokenLimit) {
    parts.push(`${formatTokenCount(model.inputTokenLimit)} in`);
  }

  if (model.outputTokenLimit) {
    parts.push(`${formatTokenCount(model.outputTokenLimit)} out`);
  }

  return parts.length > 0 ? parts.join(" / ") : null;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
  }

  return value.toLocaleString();
}

function Field({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

