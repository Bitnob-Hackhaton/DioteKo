import 'reflect-metadata';
// FIRST — loads the NODE_ENV-selected file (.env / .env.test / .env.prod)
// before the options below read process.env.
import '../config/load-env';
import { DataSource, DataSourceOptions } from 'typeorm';
import { envFilePathForNodeEnv } from '../config/env-files';

/**
 * Standalone TypeORM CLI data source (migration:generate / migration:run /
 * migration:revert — see package.json scripts). Runs outside the Nest
 * application context via `typeorm-ts-node-commonjs`, so it reads directly
 * from `process.env` (loaded from the NODE_ENV-selected file) rather than
 * Nest's ConfigService.
 *
 * Keep the connection fields in sync with `src/config/configuration.ts` —
 * both resolve their env file the same way (config/env-files.ts), so the app,
 * migrations and seed always target the same database for a given NODE_ENV.
 *
 * No silent fallback for host/name: a missing env file must fail loudly here
 * (mirrors the app's `@IsNotEmpty()` boot check) so a forgotten
 * `cross-env NODE_ENV=test` can't run `migration:revert` against the wrong DB.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[data-source] ${name} is not set. Ensure backend-nest/${envFilePathForNodeEnv()} exists ` +
        `(NODE_ENV=${process.env.NODE_ENV ?? 'development'}).`,
    );
  }
  return value;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: required('DB_HOST'),
  port: parseInt(process.env.DB_PORT || '5435', 10),
  username: required('DB_USERNAME'),
  password: required('DB_PASSWORD'),
  database: required('DB_NAME'),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
