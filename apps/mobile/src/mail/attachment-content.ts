import { File } from 'expo-file-system';

export async function localAttachmentBase64(uri: string) {
  const file = new File(uri);
  if (!file.exists || file.size > 18 * 1024 * 1024) throw new Error('This attachment is missing or too large. Remove it and choose a file smaller than 18 MiB.');
  return file.base64();
}
