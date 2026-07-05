import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Platform, PlatformAccessType, PlatformAuthStatus, Prisma } from "../../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
import { assertActiveOrganizationMember } from "../common/organization-access";
import { CreatePlatformAccountDto } from "./platform-accounts.dto";

@Injectable()
export class PlatformAccountsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreatePlatformAccountDto & { actorUserId: string }) {
    const {
      actorUserId,
      organizationId,
      platform,
      displayName,
      username,
      providerAccountId,
      tokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      settings,
      accessType = PlatformAccessType.manual,
      authStatus = PlatformAuthStatus.active,
    } = dto;

    if (!organizationId || !platform || !displayName || !actorUserId) {
      throw new HttpException("organizationId, platform, displayName, actorUserId are required", HttpStatus.BAD_REQUEST);
    }

    if (!Object.values(Platform).includes(platform)) {
      throw new HttpException(`unsupported platform: ${platform}`, HttpStatus.BAD_REQUEST);
    }
    if (!Object.values(PlatformAccessType).includes(accessType)) {
      throw new HttpException(`unsupported accessType: ${accessType}`, HttpStatus.BAD_REQUEST);
    }
    if (!Object.values(PlatformAuthStatus).includes(authStatus)) {
      throw new HttpException(`unsupported authStatus: ${authStatus}`, HttpStatus.BAD_REQUEST);
    }
    const tokenExpiresAtDate = tokenExpiresAt ? new Date(tokenExpiresAt) : null;
    if (tokenExpiresAtDate && Number.isNaN(tokenExpiresAtDate.getTime())) {
      throw new HttpException("tokenExpiresAt must be ISO datetime string", HttpStatus.BAD_REQUEST);
    }

    await assertActiveOrganizationMember(this.prisma, organizationId, actorUserId);

    return this.prisma.platformAccount.create({
      data: {
        organizationId,
        platform,
        displayName,
        username: username ?? null,
        providerAccountId: providerAccountId ?? null,
        tokenEncrypted: tokenEncrypted ?? null,
        refreshTokenEncrypted: refreshTokenEncrypted ?? null,
        tokenExpiresAt: tokenExpiresAtDate,
        settings: (settings ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        accessType,
        authStatus,
      },
    });
  }

  findByOrganizationId({ organizationId, actorUserId }: { organizationId: string; actorUserId: string }) {
    if (!organizationId || !actorUserId) {
      throw new HttpException("organizationId, actorUserId are required", HttpStatus.BAD_REQUEST);
    }

    return assertActiveOrganizationMember(this.prisma, organizationId, actorUserId).then(() =>
      this.prisma.platformAccount.findMany({
        where: {
          organizationId,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }

  async listByIds(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }

    return this.prisma.platformAccount.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
}
