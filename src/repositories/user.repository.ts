import { User, IUser } from '../models/User.model';
import { AppError } from '../utils/AppError';

export class UserRepository {
  async findByPhone(phone: string): Promise<IUser | null> {
    return User.findOne({ phone });
  }

  async findById(id: string): Promise<IUser | null> {
    return User.findById(id);
  }

  async findByEntityId(coupleId: string): Promise<IUser[]> {
    return User.find({ coupleId });
  }

  /**
   * Upsert a user by phone.
   * Creates if not found, returns existing if found.
   */
  async upsertByPhone(
    phone: string,
    coupleId: string,
    role: 'primary' | 'partner',
  ): Promise<IUser> {
    const existing = await User.findOne({ phone });
    if (existing) {
      return existing;
    }

    return User.create({ phone, coupleId, role, isPhoneVerified: false });
  }

  async markVerified(phone: string): Promise<IUser> {
    const user = await User.findOneAndUpdate(
      { phone },
      { isPhoneVerified: true },
      { new: true },
    );
    if (!user) {
      throw new AppError(`User not found for phone: ${phone}`, 404, 'USER_NOT_FOUND');
    }
    return user;
  }

  async saveRefreshTokenHash(userId: string, hash: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { refreshTokenHash: hash });
  }

  async clearRefreshToken(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
  }

  async findByIdWithRefreshToken(userId: string): Promise<IUser & { refreshTokenHash?: string } | null> {
    return User.findById(userId).select('+refreshTokenHash');
  }

  async update(id: string, data: Partial<IUser>): Promise<IUser> {
    const user = await User.findByIdAndUpdate(id, data, { new: true });
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    return user;
  }
}

export const userRepository = new UserRepository();
