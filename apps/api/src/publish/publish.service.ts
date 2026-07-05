import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  ContentItemStatus,
  Platform,
  Prisma,
  PublishErrorType,
  PublishTaskStatus,
  PublishTargetStatus,
} from "../../../../packages/database/src";
import { getProvider, type PublishRequest } from "../../../../packages/providers/src";
import { PrismaService } from "../prisma/prisma.service";
import { assertActiveOrganizationMember, listActorOrganizationIds } from "../common/organization-access";
import {
  CreatePublishTaskDto,
  PublishTargetManualCompleteDto,
} from "./publish.dto";
import { PublishQueueService } from "./publish-queue.service";

type PublishTaskWithRelations = Prisma.PublishTaskGetPayload<{
  include: {
    targets: {
      include: {
        platformAccount: true;
        contentVersion: {
          include: {
            media: {
              include: {
                mediaAsset: true;
              };
            };
          };
        };
      };
    };
  };
}>;
type PublishExecutionResult = Awaited<ReturnType<ReturnType<typeof getProvider>["publish"]>>;

@Injectable()
export class PublishService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PublishQueueService)
    private readonly publishQueueService: PublishQueueService,
  ) {}

  async createTask(dto: CreatePublishTaskDto & { actorUserId: string }) {
    const {
      actorUserId,
      organizationId,
      contentItemId,
      scheduledAt,
      targets,
    } = dto;

    if (!actorUserId || !organizationId || !contentItemId) {
      throw new HttpException("organizationId, contentItemId, actorUserId are required", HttpStatus.BAD_REQUEST);
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new HttpException("targets cannot be empty", HttpStatus.BAD_REQUEST);
    }

    const item = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      select: { organizationId: true },
    });
    if (!item) {
      throw new HttpException("content item not found", HttpStatus.NOT_FOUND);
    }
    if (item.organizationId !== organizationId) {
      throw new HttpException("organizationId mismatch", HttpStatus.BAD_REQUEST);
    }

    await assertActiveOrganizationMember(this.prisma, item.organizationId, actorUserId);

    const scheduledAtDate = scheduledAt ? this.parseDate(scheduledAt, "scheduledAt") : undefined;
    const normalizedTaskStatus = scheduledAt ? PublishTaskStatus.scheduled : PublishTaskStatus.draft;
    const uniqueTargetKeys = new Set<string>();

    const platformAccountIds = [...new Set(targets.map((target) => target.platformAccountId))];
    const contentVersionIds = [...new Set(targets.map((target) => target.contentVersionId))];

    const [platformAccounts, contentVersions] = await Promise.all([
      this.prisma.platformAccount.findMany({
        where: {
          id: { in: platformAccountIds },
          organizationId,
          deletedAt: null,
        },
      }),
      this.prisma.contentVersion.findMany({
        where: {
          id: { in: contentVersionIds },
        },
        select: {
          id: true,
          contentItemId: true,
          platform: true,
        },
      }),
    ]);

    const platformAccountMap = new Map(platformAccounts.map((item) => [item.id, item]));
    const contentVersionMap = new Map(contentVersions.map((item) => [item.id, item]));

    for (const target of targets) {
      if (!target.platformAccountId || !target.contentVersionId) {
        throw new HttpException("each target requires platformAccountId and contentVersionId", HttpStatus.BAD_REQUEST);
      }
      const platformAccount = platformAccountMap.get(target.platformAccountId);
      if (!platformAccount) {
        throw new HttpException(`platform account not found: ${target.platformAccountId}`, HttpStatus.NOT_FOUND);
      }
      const version = contentVersionMap.get(target.contentVersionId);
      if (!version) {
        throw new HttpException(`content version not found: ${target.contentVersionId}`, HttpStatus.NOT_FOUND);
      }
      if (version.contentItemId !== contentItemId) {
        throw new HttpException("content version does not belong to content item", HttpStatus.BAD_REQUEST);
      }
      if (version.platform !== platformAccount.platform) {
        throw new HttpException("content version platform must match platform account", HttpStatus.BAD_REQUEST);
      }

      const key = `${platformAccount.platform}:${platformAccount.id}:${version.id}`;
      if (uniqueTargetKeys.has(key)) {
        throw new HttpException("duplicate target in one task", HttpStatus.BAD_REQUEST);
      }
      uniqueTargetKeys.add(key);
    }

    try {
      return this.prisma.$transaction(async (tx) => {
        const task = await tx.publishTask.create({
          data: {
            organizationId,
            contentItemId,
            createdBy: actorUserId,
            status: normalizedTaskStatus,
            scheduledAt: scheduledAtDate,
            targets: {
              create: targets.map((target) => {
                const version = contentVersionMap.get(target.contentVersionId)!;
                const taskTargetScheduledAt = target.scheduledAt
                  ? this.parseDate(target.scheduledAt, "target.scheduledAt")
                  : scheduledAtDate;
                return {
                  platformAccountId: target.platformAccountId,
                  contentVersionId: target.contentVersionId,
                  platform: version.platform,
                  scheduledAt: taskTargetScheduledAt,
                  idempotencyKey:
                    target.idempotencyKey ??
                    `${organizationId}-${target.platformAccountId}-${target.contentVersionId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
                  status: PublishTargetStatus.pending,
                };
              }),
            },
          },
          include: {
            targets: true,
          },
        });

        await tx.contentItem.update({
          where: { id: contentItemId },
          data: { status: ContentItemStatus.ready },
        });

        return task;
      });
    } catch (error) {
      if (this.isPrismaConflictError(error)) {
        throw new HttpException("publish target idempotency conflict", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async findAll({ organizationId, actorUserId }: { organizationId?: string; actorUserId: string }) {
    if (!actorUserId) {
      throw new HttpException("actorUserId is required", HttpStatus.BAD_REQUEST);
    }

    const membershipOrganizationIds = await listActorOrganizationIds(this.prisma, actorUserId);

    if (!organizationId) {
      return this.prisma.publishTask.findMany({
        where: {
          organizationId: { in: membershipOrganizationIds },
          deletedAt: null,
        },
        include: { targets: true },
        orderBy: { createdAt: "desc" },
      });
    }

    await assertActiveOrganizationMember(this.prisma, organizationId, actorUserId);
    return this.prisma.publishTask.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      include: { targets: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(taskId: string, actorUserId: string) {
    if (!actorUserId) {
      throw new HttpException("actorUserId is required", HttpStatus.BAD_REQUEST);
    }
    if (!taskId) {
      throw new HttpException("publish task id is required", HttpStatus.BAD_REQUEST);
    }

    const task = await this.prisma.publishTask.findUnique({
      where: { id: taskId },
      include: {
        targets: {
          include: {
            platformAccount: true,
            contentVersion: { include: { contentItem: true } },
            result: true,
            errors: true,
            manualInstruction: true,
          },
        },
      },
    });
    if (!task) {
      throw new HttpException("publish task not found", HttpStatus.NOT_FOUND);
    }

    await assertActiveOrganizationMember(this.prisma, task.organizationId, actorUserId);
    return task;
  }

  async run(taskId: string, actorUserId: string) {
    const task = await this.getTaskForExecution(taskId);
    await assertActiveOrganizationMember(this.prisma, task.organizationId, actorUserId);

    if (task.targets.length === 0) {
      throw new HttpException("publish task has no targets", HttpStatus.BAD_REQUEST);
    }

    const noAutoExecutionStatuses = new Set<PublishTargetStatus>([
      PublishTargetStatus.success,
      PublishTargetStatus.manual_required,
    ]);
    const allTargetsNeedNoExecution = task.targets.every((target) => noAutoExecutionStatuses.has(target.status));
    if (allTargetsNeedNoExecution) {
      return this.findById(taskId, actorUserId);
    }

    if (task.status === PublishTaskStatus.processing) {
      return this.findById(taskId, actorUserId);
    }

    await this.prisma.publishTask.update({
      where: { id: taskId },
      data: {
        status: PublishTaskStatus.processing,
        startedAt: new Date(),
      },
    });

    try {
      await this.publishQueueService.enqueueRun(taskId);
    } catch (error) {
      await this.prisma.publishTask.update({
        where: { id: taskId },
        data: {
          status: PublishTaskStatus.failed,
          finishedAt: new Date(),
        },
      });
      throw new HttpException(
        `publish queue enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.findById(taskId, actorUserId);
  }

  async executeNow(taskId: string) {
    const task = await this.getTaskForExecution(taskId);

    if (task.targets.length === 0) {
      throw new HttpException("publish task has no targets", HttpStatus.BAD_REQUEST);
    }

    for (const target of task.targets) {
      if (
        target.status === PublishTargetStatus.success ||
        target.status === PublishTargetStatus.manual_required ||
        target.status === PublishTargetStatus.skipped ||
        target.status === PublishTargetStatus.canceled
      ) {
        continue;
      }

      await this.prisma.publishTarget.update({
        where: { id: target.id },
        data: {
          status: PublishTargetStatus.processing,
          startedAt: new Date(),
        },
      });

      const request = this.buildPublishRequest(task, target);
      try {
        const provider = getProvider(request.contentVersion.platform);
        const result = await provider.publish(request);
        await this.applyProviderResult(taskId, target.id, result, request);
      } catch (error: unknown) {
        await this.recordProviderFailure(taskId, target.id, error instanceof Error ? error.message : String(error));
      }
    }

    const refreshed = await this.findTaskWithExecutionRelations(taskId);
    if (!refreshed) {
      throw new HttpException("publish task not found", HttpStatus.NOT_FOUND);
    }

    const nextStatus = this.deriveTaskStatus(refreshed.targets.map((target) => target.status));
    const updateData = this.isTaskCompleted(nextStatus)
      ? { status: nextStatus, finishedAt: new Date() }
      : { status: nextStatus };

    await this.prisma.publishTask.update({
      where: { id: taskId },
      data: updateData,
    });

    return this.findTaskWithExecutionRelations(taskId);
  }

  private async findTaskWithExecutionRelations(taskId: string) {
    return this.prisma.publishTask.findUnique({
      where: { id: taskId },
      include: {
        targets: {
          include: {
            platformAccount: true,
            contentVersion: true,
            manualInstruction: true,
            result: true,
            errors: true,
          },
        },
      },
    });
  }

  async completeManualTarget(
    taskId: string,
    targetId: string,
    actorUserId: string,
    dto: PublishTargetManualCompleteDto,
  ) {
    if (!dto.externalUrl || dto.externalUrl.trim().length === 0) {
      throw new HttpException("externalUrl is required", HttpStatus.BAD_REQUEST);
    }

    const target = await this.prisma.publishTarget.findUnique({
      where: { id: targetId },
      include: {
        publishTask: true,
      },
    });
    if (!target) {
      throw new HttpException("publish target not found", HttpStatus.NOT_FOUND);
    }
    if (target.publishTaskId !== taskId) {
      throw new HttpException("target not belongs to task", HttpStatus.BAD_REQUEST);
    }
    if (target.status !== PublishTargetStatus.manual_required && target.status !== PublishTargetStatus.processing) {
      throw new HttpException("target is not in manual publish status", HttpStatus.BAD_REQUEST);
    }

    await assertActiveOrganizationMember(this.prisma, target.publishTask.organizationId, actorUserId);

    const publishedAt = dto.publishedAt ? this.parseDate(dto.publishedAt, "publishedAt") : new Date();
    await this.prisma.publishTarget.update({
      where: { id: targetId },
      data: {
        status: PublishTargetStatus.success,
        finishedAt: publishedAt,
      },
    });
    await this.prisma.publishResult.upsert({
      where: { publishTargetId: targetId },
      create: {
        publishTargetId: targetId,
        providerPostId: dto.providerPostId ?? null,
        externalUrl: dto.externalUrl,
        publishedAt,
        responseData: this.toJson({
          source: "manual_fill",
          note: dto.note,
          updatedBy: actorUserId,
        }),
      },
      update: {
        providerPostId: dto.providerPostId ?? null,
        externalUrl: dto.externalUrl,
        publishedAt,
        responseData: this.toJson({
          source: "manual_fill",
          note: dto.note,
          updatedBy: actorUserId,
        }),
      },
    });

    await this.refreshTaskStatus(taskId);
    return this.findById(taskId, actorUserId);
  }

  private buildPublishRequest(task: PublishTaskWithRelations, target: PublishTaskWithRelations["targets"][number]): PublishRequest {
    const account = target.platformAccount;
    const version = target.contentVersion;
    return {
      organizationId: task.organizationId,
      platformAccount: {
        id: account.id,
        displayName: account.displayName,
        platform: account.platform as Platform,
        username: account.username,
        accessType: account.accessType,
        accessToken: account.tokenEncrypted,
        accessTokenSecret: account.refreshTokenEncrypted,
        tokenEncrypted: account.tokenEncrypted,
        refreshTokenEncrypted: account.refreshTokenEncrypted,
        tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
        settings: account.settings,
      },
      contentVersion: {
        id: version.id,
        title: version.title,
        body: version.body,
        platform: version.platform as Platform,
        contentType: version.contentType,
        tags: version.tags,
        topics: version.topics,
        settings: version.settings,
        media: version.media.map((item) => ({
          path: item.mediaAsset.path,
          url: item.mediaAsset.path,
          mimeType: item.mediaAsset.mimeType,
          originalName: item.mediaAsset.originalName,
        })),
      },
    };
  }

  private async applyProviderResult(
    taskId: string,
    targetId: string,
    result: PublishExecutionResult,
    request: PublishRequest,
  ) {
    if (result.status === "published") {
      await this.prisma.publishResult.upsert({
        where: { publishTargetId: targetId },
        create: {
          publishTargetId: targetId,
          providerPostId: result.providerPostId ?? null,
          externalUrl: result.externalUrl ?? null,
          publishedAt: new Date(),
          responseData: this.toJson({
            source: "provider",
            platform: request.platformAccount.platform,
            provider: request.platformAccount.id,
          }),
        },
        update: {
          providerPostId: result.providerPostId ?? null,
          externalUrl: result.externalUrl ?? null,
          publishedAt: new Date(),
          responseData: this.toJson({
            source: "provider",
            platform: request.platformAccount.platform,
            provider: request.platformAccount.id,
          }),
        },
      });
      await this.prisma.publishTarget.update({
        where: { id: targetId },
        data: {
          status: PublishTargetStatus.success,
          finishedAt: new Date(),
          retryCount: { increment: 1 },
        },
      });
      return;
    }

    if (result.status === "manual_required") {
      await this.prisma.manualPublishInstruction.upsert({
        where: { publishTargetId: targetId },
        create: {
          publishTargetId: targetId,
          platform: request.platformAccount.platform,
          accountSnapshot: this.toJson({
            platformAccountId: request.platformAccount.id,
            displayName: request.platformAccount.displayName,
            username: request.platformAccount.username ?? null,
          }),
          contentSnapshot: this.toJson({
            contentVersionId: request.contentVersion.id,
            title: request.contentVersion.title,
            body: request.contentVersion.body,
            platform: request.contentVersion.platform,
            contentType: request.contentVersion.contentType,
            tags: request.contentVersion.tags,
            topics: request.contentVersion.topics,
          }),
          mediaSnapshot: Prisma.JsonNull,
          instruction: this.toJson(
            result.manualInstruction ?? {
              title: "需要手工发布",
            },
          ),
          checklist: this.toJson([]),
        },
        update: {
          accountSnapshot: this.toJson({
            platformAccountId: request.platformAccount.id,
            displayName: request.platformAccount.displayName,
            username: request.platformAccount.username ?? null,
          }),
          contentSnapshot: this.toJson({
            contentVersionId: request.contentVersion.id,
            title: request.contentVersion.title,
            body: request.contentVersion.body,
            platform: request.contentVersion.platform,
            contentType: request.contentVersion.contentType,
            tags: request.contentVersion.tags,
            topics: request.contentVersion.topics,
          }),
          mediaSnapshot: Prisma.JsonNull,
          instruction: this.toJson(
            result.manualInstruction ?? {
              title: "需要手工发布",
            },
          ),
          checklist: this.toJson([]),
        },
      });

      await this.prisma.publishTarget.update({
        where: { id: targetId },
        data: {
          status: PublishTargetStatus.manual_required,
          finishedAt: new Date(),
          retryCount: { increment: 1 },
        },
      });
      return;
    }

    await this.prisma.publishError.create({
      data: {
        publishTargetId: targetId,
        errorType: PublishErrorType.provider_error,
        errorMessage: result.errorMessage ?? "provider publish failed",
        retryable: true,
        errorDetail: this.toJson({
          platform: request.platformAccount.platform,
          platformAccountId: request.platformAccount.id,
          taskId,
        }),
      },
    });
    await this.prisma.publishTarget.update({
      where: { id: targetId },
      data: {
        status: PublishTargetStatus.failed,
        lastErrorType: PublishErrorType.provider_error,
        finishedAt: new Date(),
        retryCount: { increment: 1 },
      },
    });
  }

  private async refreshTaskStatus(taskId: string) {
    const task = await this.prisma.publishTask.findUnique({
      where: { id: taskId },
      include: { targets: true },
    });
    if (!task) {
      return;
    }

    const nextStatus = this.deriveTaskStatus(task.targets.map((target) => target.status));
    const updateData = this.isTaskCompleted(nextStatus)
      ? { status: nextStatus, finishedAt: new Date() }
      : { status: nextStatus };
    await this.prisma.publishTask.update({
      where: { id: taskId },
      data: updateData,
    });
  }

  private async getTaskForExecution(taskId: string): Promise<PublishTaskWithRelations> {
    const task = await this.prisma.publishTask.findUnique({
      where: { id: taskId },
      include: {
        targets: {
          include: {
            platformAccount: true,
            contentVersion: {
              include: {
                media: {
                  include: {
                    mediaAsset: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!task) {
      throw new HttpException("publish task not found", HttpStatus.NOT_FOUND);
    }
    return task;
  }

  private deriveTaskStatus(targetStatuses: PublishTargetStatus[]) {
    if (targetStatuses.length === 0) {
      return PublishTaskStatus.draft;
    }

    if (targetStatuses.every((status) => status === PublishTargetStatus.success)) {
      return PublishTaskStatus.success;
    }
    if (
      targetStatuses.some((status) => status === PublishTargetStatus.processing) ||
      targetStatuses.some((status) => status === PublishTargetStatus.pending) ||
      targetStatuses.some((status) => status === PublishTargetStatus.scheduled)
    ) {
      return PublishTaskStatus.processing;
    }
    if (
      targetStatuses.some((status) => status === PublishTargetStatus.manual_required) ||
      targetStatuses.some((status) => status === PublishTargetStatus.manual_in_progress)
    ) {
      return PublishTaskStatus.waiting_manual;
    }
    if (targetStatuses.every((status) => status === PublishTargetStatus.failed)) {
      return PublishTaskStatus.failed;
    }
    if (targetStatuses.some((status) => status === PublishTargetStatus.failed)) {
      return targetStatuses.some((status) => status === PublishTargetStatus.success)
        ? PublishTaskStatus.partial_success
        : PublishTaskStatus.failed;
    }
    return PublishTaskStatus.draft;
  }

  private isTaskCompleted(status: PublishTaskStatus) {
    return (
      status === PublishTaskStatus.success ||
      status === PublishTaskStatus.failed ||
      status === PublishTaskStatus.waiting_manual ||
      status === PublishTaskStatus.partial_success
    );
  }

  private parseDate(value: string, fieldName: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpException(`${fieldName} must be ISO datetime`, HttpStatus.BAD_REQUEST);
    }
    return parsed;
  }

  private isPrismaConflictError(error: unknown) {
    if (!error || typeof error !== "object") {
      return false;
    }
    const typed = error as { code?: string };
    return typed.code === "P2002";
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private async recordProviderFailure(taskId: string, targetId: string, message: string) {
    await this.prisma.publishError.create({
      data: {
        publishTargetId: targetId,
        errorType: PublishErrorType.provider_error,
        errorMessage: message || "provider publish failed",
        retryable: true,
        errorDetail: this.toJson({
          source: "runtime",
          taskId,
        }),
      },
    });
    await this.prisma.publishTarget.update({
      where: { id: targetId },
      data: {
        status: PublishTargetStatus.failed,
        lastErrorType: PublishErrorType.provider_error,
        finishedAt: new Date(),
        retryCount: { increment: 1 },
      },
    });
  }
}
