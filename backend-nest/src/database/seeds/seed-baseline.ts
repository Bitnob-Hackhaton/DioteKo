/**
 * Baseline seed logic, shared by:
 *  - `seed.ts` — the `npm run seed` CLI (dev + test DBs, via db:setup/db:reset),
 *  - `test/utils/reset-database.ts` — re-applied after every E2E `TRUNCATE`.
 *
 * Seeds the minimum data the app needs to be exercised:
 *  - the 4 static roles (`holder`/`issuer`/`verifier`/`admin`),
 *  - one demo municipality `Organization` — `modules/admin-certificates`'
 *    `createRequest` 404s without an org of type `municipality|ministry`,
 *  - an issuer DID for that org, created through the real `DidService`,
 *  - three demo email+password users, one per staff-facing role
 *    (`issuer` / `admin` / `holder`), so the full request → pay → issue →
 *    verify lifecycle can be driven from E2E without an Appwrite
 *    round-trip.
 *
 * Idempotent: every insert is check-then-insert on a unique key.
 *
 * Takes an `INestApplicationContext` (satisfied by both
 * `NestFactory.createApplicationContext(AppModule)` and the E2E testing app)
 * so it can call the real `DidService.createDid` rather than re-implementing
 * DID creation.
 */
import { INestApplicationContext, Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { DidService } from '../../modules/did-vc/services/did.service';
import { Organization, OrganizationType } from '../../modules/identity/entities/organization.entity';
import { Role, RoleCode } from '../../modules/identity/entities/role.entity';
import { User } from '../../modules/identity/entities/user.entity';
import { UserRole } from '../../modules/identity/entities/user-role.entity';

const logger = new Logger('SeedBaseline');

export const DEMO_ORG_NAME = 'Mairie Centrale Dakar';
const BCRYPT_SALT_ROUNDS = 10;

/**
 * LOCAL-DEV / TEST-ONLY demo credentials. Clearly marked so it is obvious these
 * must never be reused as real credentials outside local/demo/E2E use. The
 * seed is dev-only (never run in staging/production) — see `seed.ts`.
 */
export const DEMO_USERS: ReadonlyArray<{
  email: string;
  password: string;
  displayName: string;
  role: RoleCode;
  linkToDemoOrg: boolean;
}> = [
  {
    email: 'issuer-demo@dioteko.local',
    password: 'demo-password-change-me',
    displayName: 'Demo Issuer (Mairie Centrale Dakar)',
    role: RoleCode.ISSUER,
    linkToDemoOrg: true,
  },
  {
    email: 'admin-demo@dioteko.local',
    password: 'demo-password-change-me',
    displayName: 'Demo Admin',
    role: RoleCode.ADMIN,
    linkToDemoOrg: true,
  },
  {
    email: 'holder-demo@dioteko.local',
    password: 'demo-password-change-me',
    displayName: 'Demo Holder',
    role: RoleCode.HOLDER,
    linkToDemoOrg: false,
  },
];

async function ensureRoles(rolesRepository: Repository<Role>): Promise<Map<RoleCode, Role>> {
  const codes = [RoleCode.HOLDER, RoleCode.ISSUER, RoleCode.VERIFIER, RoleCode.ADMIN];
  const roleByCode = new Map<RoleCode, Role>();

  for (const code of codes) {
    let role = await rolesRepository.findOne({ where: { code } });
    if (!role) {
      role = await rolesRepository.save(rolesRepository.create({ code }));
      logger.log(`[RESULT] role created code=${code} id=${role.id}`);
    } else {
      logger.log(`[RESULT] role already present code=${code} id=${role.id}`);
    }
    roleByCode.set(code, role);
  }

  return roleByCode;
}

async function ensureDemoOrganization(
  organizationsRepository: Repository<Organization>,
): Promise<Organization> {
  let organization = await organizationsRepository.findOne({ where: { name: DEMO_ORG_NAME } });
  if (!organization) {
    organization = await organizationsRepository.save(
      organizationsRepository.create({ name: DEMO_ORG_NAME, type: OrganizationType.MUNICIPALITY }),
    );
    logger.log(`[RESULT] organization created id=${organization.id} name=${organization.name}`);
  } else {
    logger.log(`[RESULT] organization already present id=${organization.id} name=${organization.name}`);
  }
  return organization;
}

async function ensureIssuerDid(didService: DidService, organizationId: string): Promise<void> {
  const existing = await didService.findByController(undefined, organizationId);
  if (existing) {
    logger.log(`[RESULT] issuer DID already present organizationId=${organizationId} did=${existing.did}`);
    return;
  }
  const did = await didService.createDid(undefined, organizationId);
  logger.log(`[RESULT] issuer DID created organizationId=${organizationId} did=${did.did}`);
}

async function ensureDemoUser(
  usersRepository: Repository<User>,
  userRolesRepository: Repository<UserRole>,
  role: Role,
  spec: (typeof DEMO_USERS)[number],
  organizationId: string,
): Promise<void> {
  let user = await usersRepository.findOne({ where: { email: spec.email } });
  if (!user) {
    const passwordHash = await bcrypt.hash(spec.password, BCRYPT_SALT_ROUNDS);
    user = await usersRepository.save(
      usersRepository.create({
        email: spec.email,
        passwordHash,
        displayName: spec.displayName,
        organizationId: spec.linkToDemoOrg ? organizationId : null,
      }),
    );
    logger.log(`[RESULT] demo user created id=${user.id} email=${user.email} role=${spec.role}`);
  } else {
    logger.log(`[RESULT] demo user already present id=${user.id} email=${user.email} role=${spec.role}`);
  }

  const existingGrant = await userRolesRepository.findOne({
    where: { userId: user.id, roleId: role.id },
  });
  if (!existingGrant) {
    await userRolesRepository.save(userRolesRepository.create({ userId: user.id, roleId: role.id }));
    logger.log(`[RESULT] role granted userId=${user.id} role=${spec.role}`);
  } else {
    logger.log(`[RESULT] role already granted userId=${user.id} role=${spec.role}`);
  }
}

/**
 * Apply the full baseline against whatever database the given Nest context is
 * connected to. Safe to call repeatedly (idempotent) and after a `TRUNCATE`.
 */
export async function seedBaseline(app: INestApplicationContext): Promise<void> {
  // Defense-in-depth (the seed CLI and the E2E reset already guard upstream):
  // this inserts admin-demo@dioteko.local / demo-password-change-me with the
  // ADMIN role and a @Public() bcrypt login — never against a real DB.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[seedBaseline] refusing to run with NODE_ENV=production');
  }
  logger.log('[START] seedBaseline');

  const rolesRepository = app.get<Repository<Role>>(getRepositoryToken(Role));
  const organizationsRepository = app.get<Repository<Organization>>(getRepositoryToken(Organization));
  const usersRepository = app.get<Repository<User>>(getRepositoryToken(User));
  const userRolesRepository = app.get<Repository<UserRole>>(getRepositoryToken(UserRole));
  const didService = app.get(DidService);

  const roleByCode = await ensureRoles(rolesRepository);
  const organization = await ensureDemoOrganization(organizationsRepository);
  await ensureIssuerDid(didService, organization.id);

  for (const spec of DEMO_USERS) {
    const role = roleByCode.get(spec.role);
    if (!role) {
      // Unreachable: ensureRoles always populates all 4 codes or throws.
      throw new Error(`[seedBaseline] role missing after ensureRoles: ${spec.role}`);
    }
    await ensureDemoUser(usersRepository, userRolesRepository, role, spec, organization.id);
  }

  logger.log(
    `[RESULT] seedBaseline ok roles=${roleByCode.size} org=${organization.name} users=${DEMO_USERS.length}`,
  );
  logger.log('[STATE] seedBaseline complete');
}
