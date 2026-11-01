import type { SymbolViewProps } from 'expo-symbols';

/** SF Symbol names, taken from expo-symbols so no extra dependency is needed. */
export type SFSymbol = Extract<SymbolViewProps['name'], string>;
