import {
  Platform,
  PublishErrorType,
  PublishTaskStatus,
  PublishTargetStatus,
} from "../../../../packages/database/src";

export interface CreatePublishTaskTargetDto {
  platformAccountId: string;
  contentVersionId: string;
  scheduledAt?: string;
  idempotencyKey?: string;
}

export interface CreatePublishTaskDto {
  organizationId: string;
  contentItemId: string;
  scheduledAt?: string;
  status?: PublishTaskStatus;
  targets: CreatePublishTaskTargetDto[];
}

export interface PublishTargetManualCompleteDto {
  externalUrl: string;
  providerPostId?: string;
  publishedAt?: string;
  note?: string;
}

export interface PublishTaskStatusChangeRecord {
  platform: Platform;
  targetId: string;
  previousStatus: PublishTargetStatus;
  nextStatus: PublishTargetStatus;
  errorType?: PublishErrorType;
  errorMessage?: string;
}
