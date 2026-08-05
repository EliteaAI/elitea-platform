type ArtifactKind = 'file' | 'folder';

export interface ArtifactListItem {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly size: number;
  readonly lastModified?: string;
}

export interface ArtifactTreeItem extends ArtifactListItem {
  readonly children?: readonly ArtifactTreeItem[];
}

export interface ArtifactBreadcrumb {
  readonly name: string;
  readonly path: string;
}

export interface ArtifactDataFile {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ArtifactStorageConfiguration {
  readonly id: string;
  readonly title: string;
  readonly shared: boolean;
}

interface ArtifactUploadIssue {
  readonly file: File;
  readonly reason: string;
}

export interface ArtifactUploadPlan {
  readonly accepted: readonly File[];
  readonly rejected: readonly ArtifactUploadIssue[];
  readonly duplicates: readonly string[];
  readonly targetPrefix: string;
}

export interface ZipDownloadProgress {
  readonly open: boolean;
  readonly current: number;
  readonly total: number;
  readonly filename: string;
  readonly error?: string;
}
