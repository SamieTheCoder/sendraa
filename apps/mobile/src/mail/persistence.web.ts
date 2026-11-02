export const mailStorage = {
  getItemSync(key: string): string | null { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); },
  setItemSync(key: string, value: string) { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); },
};
