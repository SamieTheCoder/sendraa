export async function localAttachmentBase64(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('This attachment is no longer available. Remove it and choose it again.');
  const blob = await response.blob();
  if (blob.size > 18 * 1024 * 1024) throw new Error('Choose an attachment smaller than 18 MiB.');
  return new Promise<string>((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(new Error('Could not read attachment.')); reader.readAsDataURL(blob);
  });
}
