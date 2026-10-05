export class PageValidationError extends Error {}
export class PageConflictError extends Error {}
export function cleanPageTitle(value: unknown): string;
export function cleanPageIcon(value: unknown): string;
export function cleanPageParentId(value: unknown): string | null;
export function serializePageDocument(document: unknown): string;
