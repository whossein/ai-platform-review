/** Version of the root package.json, injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

/** Set by the Electron preload, only in installed desktop builds that can self-update. */
interface Window {
  desktopUpdater?: {
    check(): Promise<string | null>;
    install(): Promise<void>;
  };
}
