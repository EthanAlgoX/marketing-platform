import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ContentType, Platform } from "../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateContentItemDto,
  CreateContentVersionDto,
  UpdateContentItemDto,
} from "./content.dto";
import { assertActiveOrganizationMember, listActorOrganizationIds } from "../common/organization-access";

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateContentItemDto & { actorUserId: string }) {
    const {
      organizationId,
      title,
      actorUserId,
      sourceContent,
      productInfo,
      targetAudience,
      marketingGoal,
    } = dto;

    if (!organizationId || !title || !actorUserId) {
      throw new HttpException("organizationId, title, actorUserId are required", HttpStatus.BAD_REQUEST);
    }

    await assertActiveOrganizationMember(this.prisma, organizationId, actorUserId);

    const createdBy = actorUserId;

    return this.prisma.contentItem.create({
      data: {
        organizationId,
        createdBy,
        title,
        sourceContent: sourceContent ?? null,
        productInfo: productInfo ?? null,
        targetAudience: targetAudience ?? null,
        marketingGoal: marketingGoal ?? null,
      },
    });
  }

  async findAll({
    organizationId,
    actorUserId,
  }: {
    organizationId?: string;
    actorUserId: string;
  }) {
    if (!actorUserId) {
      throw new HttpException("actorUserId is required", HttpStatus.BAD_REQUEST);
    }

    if (organizationId) {
      await this.assertMembership(organizationId, actorUserId);
    } else {
        const membershipOrganizationIds = await listActorOrganizationIds(this.prisma, actorUserId);
        if (membershipOrganizationIds.length === 0) {
          return [];
        }
    }

    return this.prisma.contentItem.findMany({
      where: organizationId
        ? { organizationId }
        : { organizationId: { in: await listActorOrganizationIds(this.prisma, actorUserId) } },
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true, platform: true, contentType: true, createdAt: true },
        },
      },
    });
  }

  async findById(
    id: string,
    { organizationId, actorUserId }: { organizationId?: string; actorUserId: string },
  ) {
    const item = await this.prisma.contentItem.findFirst({
      where: organizationId ? { id, organizationId } : { id },
      select: { organizationId: true },
    });

    if (!item) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }

    await assertActiveOrganizationMember(this.prisma, item.organizationId, actorUserId);

    return this.prisma.contentItem.findFirst({
      where: organizationId ? { id, organizationId } : { id },
      include: {
        versions: {
          include: {
            media: true,
          },
          orderBy: { createdAt: "desc" },
        },
        publishTasks: true,
      },
    });
  }

  async update(id: string, dto: UpdateContentItemDto, actorUserId: string) {
    const existing = await this.prisma.contentItem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }

    await assertActiveOrganizationMember(this.prisma, existing.organizationId, actorUserId);

    return this.prisma.contentItem.update({
      where: { id },
      data: {
        title: dto.title ?? existing.title,
        sourceContent: dto.sourceContent ?? existing.sourceContent,
        productInfo: dto.productInfo ?? existing.productInfo,
        targetAudience: dto.targetAudience ?? existing.targetAudience,
        marketingGoal: dto.marketingGoal ?? existing.marketingGoal,
        status: dto.status ?? existing.status,
      },
    });
  }

  async createVersion(dto: CreateContentVersionDto & { contentItemId: string; actorUserId: string }) {
    const {
      contentItemId,
      platform,
      contentType,
      editedBy,
      actorUserId,
      title,
      body,
      tags,
      topics,
      settings,
    } =
      dto;
    if (!contentItemId || !platform || !contentType || !actorUserId) {
      throw new HttpException(
        "contentItemId, platform, contentType, actorUserId are required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { organizationId: true },
    });

    if (!item) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }

    await assertActiveOrganizationMember(this.prisma, item.organizationId, actorUserId);

    if (!Object.values(ContentType).includes(contentType)) {
      throw new HttpException("invalid contentType", HttpStatus.BAD_REQUEST);
    }

    if (!Object.values(Platform).includes(platform)) {
      throw new HttpException("invalid platform", HttpStatus.BAD_REQUEST);
    }

    return this.prisma.contentVersion.create({
      data: {
        contentItemId,
        platform,
        contentType,
        title: title ?? null,
        body: body ?? null,
        tags: tags ?? null,
        topics: topics ?? null,
        settings: settings ?? null,
        aiGenerated: false,
        editedBy,
      },
    });
  }

}
