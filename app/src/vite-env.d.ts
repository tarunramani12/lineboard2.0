/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

/** Set by vite.config.ts; changes with every build. */
declare const __BUILD_ID__: string
