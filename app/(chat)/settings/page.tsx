import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ModelSettingsForm } from "@/components/settings/model-settings-form";
import { getUserModelPreference, listUserProviderCredentialSummaries } from "@/lib/db/queries";
import { getServerViewer } from "@/lib/session";
import { getSetupStatus } from "@/lib/setup";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const setupStatus = await getSetupStatus();
  const viewer = await getServerViewer(setupStatus);

  if (!viewer) {
    redirect("/");
  }

  const [activeProvider, credentials] = await Promise.all([
    getUserModelPreference(viewer.id),
    listUserProviderCredentialSummaries(viewer.id),
  ]);

  return <ModelSettingsForm activeProvider={activeProvider} credentials={credentials} />;
}
