import { api, ApiError } from './api';

export type SendingConfig = {
  provider: 'cloudflare' | 'gmail';
  gmail_user: string | null;
  allowed_from: string[];
  hasPassword: boolean;
  default_mailbox_id: string | null;
};

/** Distinguish a stale development API from a workspace that no longer exists. */
export async function loadSendingSettings(workspaceId: string, signal: AbortSignal) {
  try {
    return await api<{ config: SendingConfig | null }>(`/v1/tenants/${workspaceId}/sending`, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      const health = await api<{ capabilities?: string[] }>('/health', { signal }).catch(() => null);
      if (health && !health.capabilities?.includes('sending-config-v1')) {
        throw new Error('This API server has not loaded sending settings yet. Restart the Sendraa API with the latest code, then retry.');
      }
    }
    throw error;
  }
}
