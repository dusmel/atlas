// Apart from app-db, which only loads under Vite (import.meta.glob), so bun test can import what uses it.
export const dataDir = () => process.env.ATLAS_DATA_DIR ?? "/data"
