import { prisma } from '@/lib/db/prisma'
import type { ProfileRepo } from './repo'
import type { ProfileData } from './types'

export class PrismaProfileRepo implements ProfileRepo {
  async getProfile(userId: string): Promise<ProfileData | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        image: true,
        bio: true,
        bilibili: true,
        weibo: true,
        github: true,
        twitter: true,
      },
    })
    return user
  }

  async updateProfile(userId: string, data: Partial<ProfileData>): Promise<ProfileData> {
    return await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        name: true,
        image: true,
        bio: true,
        bilibili: true,
        weibo: true,
        github: true,
        twitter: true,
      },
    })
  }
}
