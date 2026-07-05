import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  ContentType,
  type Prisma,
  Platform,
} from "../../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateContentItemDto,
  CreateContentVersionDto,
  GenerateVersionsDto,
  UpdateContentItemDto,
} from "./content.dto";
import { assertActiveOrganizationMember, listActorOrganizationIds } from "../common/organization-access";

@Injectable()
export class ContentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateContentItemDto & { actorUserId: string }) {
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

    const membershipOrganizationIds = await listActorOrganizationIds(this.prisma, actorUserId);
    if (membershipOrganizationIds.length === 0) {
      return [];
    }

    if (organizationId) {
      await assertActiveOrganizationMember(this.prisma, organizationId, actorUserId);
      if (!membershipOrganizationIds.includes(organizationId)) {
        throw new HttpException("acting user is not an active member of organization", HttpStatus.FORBIDDEN);
      }
    }

    return this.prisma.contentItem.findMany({
      where: organizationId
        ? { organizationId }
        : { organizationId: { in: membershipOrganizationIds } },
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
        tags: tags === undefined ? undefined : (tags as Prisma.InputJsonValue),
        topics: topics === undefined ? undefined : (topics as Prisma.InputJsonValue),
        settings: settings === undefined ? undefined : (settings as Prisma.InputJsonValue),
        aiGenerated: false,
        editedBy,
      },
    });
  }

  async generateVersions(dto: GenerateVersionsDto & { contentItemId: string; actorUserId: string }) {
    const { contentItemId, actorUserId, versions, organizationId } = dto;

    if (!contentItemId || !actorUserId || !organizationId) {
      throw new HttpException("contentItemId, actorUserId, organizationId are required", HttpStatus.BAD_REQUEST);
    }

    if (!Array.isArray(versions) || versions.length === 0) {
      throw new HttpException("versions is required and cannot be empty", HttpStatus.BAD_REQUEST);
    }

    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: {
        organizationId: true,
        title: true,
        sourceContent: true,
        productInfo: true,
        targetAudience: true,
        marketingGoal: true,
      },
    });

    if (!item) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }

    if (item.organizationId !== organizationId) {
      throw new HttpException("organizationId mismatch", HttpStatus.BAD_REQUEST);
    }

    if (!item.sourceContent || item.sourceContent.trim().length === 0) {
      throw new HttpException("content item has no sourceContent", HttpStatus.BAD_REQUEST);
    }

    await assertActiveOrganizationMember(this.prisma, item.organizationId, actorUserId);

    const requested: Array<{ platform: Platform; contentType: ContentType; title?: string }> = [];
    const visited = new Set<string>();
    for (const version of versions) {
      const { platform, contentType, title } = version;
      if (!platform || !contentType) {
        throw new HttpException("each version requires platform and contentType", HttpStatus.BAD_REQUEST);
      }

      if (!Object.values(Platform).includes(platform)) {
        throw new HttpException(`unsupported platform: ${platform}`, HttpStatus.BAD_REQUEST);
      }

      if (!Object.values(ContentType).includes(contentType)) {
        throw new HttpException(`unsupported contentType: ${contentType}`, HttpStatus.BAD_REQUEST);
      }

      const key = `${platform}:${contentType}`;
      if (visited.has(key)) {
        throw new HttpException(`duplicate version request for ${platform}/${contentType}`, HttpStatus.BAD_REQUEST);
      }
      visited.add(key);
      requested.push({ platform, contentType, title });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const itemReq of requested) {
        const rewritten = this.buildAiVersion({
          platform: itemReq.platform,
          sourceContent: item.sourceContent ?? "",
          sourceTitle: item.title,
          productInfo: item.productInfo ?? undefined,
          targetAudience: item.targetAudience ?? undefined,
          marketingGoal: item.marketingGoal ?? undefined,
          versionTitle: itemReq.title,
          contentType: itemReq.contentType,
        });

        const createdVersion = await tx.contentVersion.create({
          data: {
            contentItemId,
            platform: itemReq.platform,
            contentType: itemReq.contentType,
            title: rewritten.title,
            body: rewritten.body,
            tags: rewritten.tags as Prisma.InputJsonValue,
            topics: rewritten.topics as Prisma.InputJsonValue,
            settings: rewritten.settings as Prisma.InputJsonValue,
            aiGenerated: true,
            editedBy: actorUserId,
          },
        });

        created.push(createdVersion);
      }

      return {
        contentItemId,
        createdVersions: created,
      };
    });
  }

  private buildAiVersion(params: {
    platform: Platform;
    sourceContent: string;
    sourceTitle: string;
    productInfo?: string | null;
    targetAudience?: string | null;
    marketingGoal?: string | null;
    contentType: ContentType;
    versionTitle?: string;
  }) {
    const platformHint = {
      xiaohongshu: {
        tone: "活泼、有生活化表达",
        cta: "收藏+评论",
        maxWords: "建议 120~250 字",
      },
      zhihu: {
        tone: "理性、有结构化论点",
        cta: "欢迎讨论，留下观点",
        maxWords: "建议 300~1200 字",
      },
      wechat_official_account: {
        tone: "品牌语气，信息密度高",
        cta: "点击阅读更多",
        maxWords: "建议 300~800 字",
      },
      x_twitter: {
        tone: "简洁有力、观点鲜明",
        cta: "转发 + 评论",
        maxWords: "建议 120 字以内",
      },
    };

    const hint = platformHint[params.platform];
    const cleanSource = params.sourceContent.replace(/\s+/g, " ").trim();
    const title = params.versionTitle ?? `${params.sourceTitle}（${params.platform}）`;
    const body = [
      `【${params.platform}】`,
      `标题：${title}`,
      "",
      cleanSource,
      "",
      `风格：${hint.tone}`,
      `目标受众：${params.targetAudience ?? "通用"}`,
      `营销目标：${params.marketingGoal ?? "提升认知"}`,
      `产品信息：${params.productInfo ?? "未填写"}`,
      `内容长度建议：${hint.maxWords}`,
      "",
      `结尾引导：${hint.cta}`,
    ].join("\n");

    return {
      title,
      body,
      tags: ["ai-generated", params.platform],
      topics: [params.platform, params.contentType],
      settings: {
        source: "mock-ai-pipeline",
        generatedAt: new Date().toISOString(),
        platform: params.platform,
        contentType: params.contentType,
      },
    };
  }
}
