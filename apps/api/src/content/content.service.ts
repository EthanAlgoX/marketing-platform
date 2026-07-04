import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
  ContentItemStatus,
  ContentType,
  Platform,
} from "../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateContentItemDto,
  CreateContentVersionDto,
  UpdateContentItemDto,
} from "./content.dto";

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateContentItemDto) {
    const { organizationId, title, createdBy, sourceContent, productInfo, targetAudience, marketingGoal } =
      dto;

    if (!organizationId || !title || !createdBy) {
      throw new HttpException("organizationId, title, createdBy are required", HttpStatus.BAD_REQUEST);
    }

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

  findAll({ organizationId }: { organizationId?: string }) {
    return this.prisma.contentItem.findMany({
      where: organizationId ? { organizationId } : undefined,
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

  findById(id: string, organizationId?: string) {
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

  async update(id: string, dto: UpdateContentItemDto) {
    const existing = await this.prisma.contentItem.findUnique({ where: { id } });
    if (!existing) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }

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

  createVersion(dto: CreateContentVersionDto & { contentItemId: string }) {
    const { contentItemId, platform, contentType, editedBy, title, body, tags, topics, settings } =
      dto;
    if (!contentItemId || !platform || !contentType) {
      throw new HttpException("contentItemId, platform, contentType are required", HttpStatus.BAD_REQUEST);
    }

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
