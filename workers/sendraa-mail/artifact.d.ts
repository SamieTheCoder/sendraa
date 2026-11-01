export declare const WORKER_NAME: 'sendraa-mail';
export declare const COMPATIBILITY_DATE: string;

export type WorkerArtifact = {
  name: string;
  compatibilityDate: string;
  /** `<package version>+<content hash>`, so any script or schema change is a new version. */
  version: string;
  script: string;
  migrations: { name: string; sql: string }[];
};

export declare function loadArtifact(): Promise<WorkerArtifact>;
