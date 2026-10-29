export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  path: string | null;
  parent: string | null;
  entries: FsEntry[];
  roots: FsEntry[];
}
