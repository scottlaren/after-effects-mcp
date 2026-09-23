export type HistoryLanguage = "en" | "ru";
export const SETTINGS_FILE: string;
export function readHistoryLanguage(bridgeFolder: string): HistoryLanguage;
export function writeHistoryLanguage(bridgeFolder: string, language: HistoryLanguage): void;
