export type JournalPriority = { id: string; text: string; done: boolean };
export type JournalPlan = {
  id: string;
  start: number;
  end: number;
  title: string;
  kind: 'focus' | 'meeting' | 'life' | 'interrupt';
  note: string;
  missed?: boolean;
  priorityId?: string;
  priorityDate?: string;
  priorityTitle?: string;
  sourcePlan?: { date: string; id: string };
};
export type JournalDay = {
  schemaVersion: 1;
  priorities: JournalPriority[];
  brain: string;
  idea: string;
  feedback: string;
  plan: JournalPlan[];
  actual: JournalPlan[];
};
export type JournalEntity = {
  id: string;
  date: string;
  day: JournalDay;
  version: number;
  createdAt: string;
  updatedAt: string;
  clientCreatedAt?: string | null;
};
export class JournalValidationError extends Error {}
export function validJournalDate(value: unknown): boolean;
export function journalId(workspaceId: string, date: string): string;
export function validateJournalDay(day: unknown): JournalDay;
export function normalizeJournalDay(day: unknown, date: string): JournalDay;
export function parseLegacyJournal(raw: string): Record<string, JournalDay>;
