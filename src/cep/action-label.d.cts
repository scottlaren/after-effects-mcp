import type { HistoryLanguage } from "./history-settings.cjs";
export function isActionLabel(value: string, language?: HistoryLanguage): boolean;
export function actionLabelError(language?: HistoryLanguage): string;
export const ACTION_LABEL_ERROR: string;
export function getScriptActionLabel(
  args: { description?: string; script?: string },
  language?: HistoryLanguage,
): string;
