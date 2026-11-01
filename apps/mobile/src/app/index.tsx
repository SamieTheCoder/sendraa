import { Redirect } from 'expo-router';

import { authClient } from '@/lib/auth-client';
import { useActiveWorkspace, useMe } from '@/lib/workspace';

/** The app's entry point, and where sign-in callbacks land. Sends people to the right place. */
export default function Index() {
  const { data: session } = authClient.useSession();
  const me = useMe(session?.user.id);
  const workspace = useActiveWorkspace();
  if (!session) return <Redirect href="/sign-in" />;
  if (me.status === 'ready' && me.me.workspaces.length === 0) return <Redirect href="/onboarding" />;
  // An admin whose mail system is not built yet goes to setup first.
  if (me.status === 'ready' && workspace?.linkedToCloudflare && workspace.setupStatus !== 'ready' && workspace.permissions.includes('domains.create')) {
    return <Redirect href="/setup" />;
  }
  if (me.status === 'ready') return <Redirect href="/mail" />;
  return null;
}
