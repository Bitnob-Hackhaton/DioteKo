/**
 * Side-effect module: loads the NODE_ENV-selected dotenv file into
 * `process.env` **at import time**.
 *
 * Import this FIRST (before anything that reads `process.env`, including
 * `AppModule`) in CLI entrypoints that run outside Nest's ConfigModule:
 * `src/database/seeds/seed.ts`, `scripts/appwrite-seed.ts`. The Nest app
 * itself doesn't need it (ConfigModule loads the file via `envFilePath`).
 *
 * `dotenv` never overrides an already-set var, so an externally-provided
 * `NODE_ENV` (cross-env) still selects the right file.
 */
import * as dotenv from 'dotenv';
import { envFilePathForNodeEnv } from './env-files';

dotenv.config({ path: envFilePathForNodeEnv() });
