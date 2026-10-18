/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** harukan service URL for the sidebar 일지 link. Default https://leneu.store/app. */
  readonly VITE_HARUKAN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
