export type PageDocument = { schemaVersion: 1; blocks: unknown[] };

export type PageSummary = {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PageRecord = PageSummary & { document: PageDocument;localRevision?:number };
