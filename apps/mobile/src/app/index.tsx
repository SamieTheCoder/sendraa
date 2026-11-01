import { Redirect } from 'expo-router';

import { authClient } from '@/lib/auth-client';
import { useMe } from '@/lib/workspace';

/** The app's entry point, and where sign-in callbacks land. Sends people to the right place. */
export default function Index() {
  const { data: session } = authClient.useSession();
  const me = useMe(session?.user.id);
  if (!session) return <Redirect href="/sign-in" />;
  if (me.status === 'ready' && me.me.workspaces.length === 0) return <Redirect href="/onboarding" />;
  if (me.status === 'ready') return <Redirect href="/mail" />;
  return null;
}
