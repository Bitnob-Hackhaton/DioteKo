import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { AccountStatus, User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';

export interface ProfileResponse {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  googleLinked: boolean;
  organizationId: string | null;
  /** Name of the user's organization (staff console header); `null` for a citizen. */
  organizationName: string | null;
  roles: string[];
  did: string | null;
}

/**
 * Thin CRUD backing for `users.controller.ts` / `auth.controller.ts`'s
 * `/me` endpoints. Kept minimal in this round — not the focus, see the
 * architecture plan's build order.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(UserRole) private readonly userRolesRepository: Repository<UserRole>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getRoleCodes(userId: string): Promise<string[]> {
    const userRoles = await this.userRolesRepository.find({ where: { userId }, relations: ['role'] });
    return userRoles.map((userRole) => userRole.role.code);
  }

  /**
   * Shared `/me` shaping logic for `AuthController.me` (`GET /auth/me`) and
   * `UsersController.me` (`GET /users/me`) — both routes expose the exact
   * same profile view, so the fetch + shape lives here once instead of
   * twice. `roles`/`did` come from the JWT payload (not a DB round trip)
   * since that's what the token was already validated against.
   */
  async getProfileResponse(currentUser: JwtPayload): Promise<ProfileResponse> {
    const user = await this.usersRepository.findOne({ where: { id: currentUser.sub }, relations: { organization: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      accountStatus: user.accountStatus,
      googleLinked: Boolean(user.googleId),
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? null,
      roles: currentUser.roles,
      did: currentUser.did ?? null,
    };
  }
}
