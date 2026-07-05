import { ContentItemStatus, Platform, ContentType } from "../../../../packages/database/src";

export interface CreateContentItemDto {
  organizationId: string;
  title: string;
  sourceContent?: string;
  productInfo?: string;
  targetAudience?: string;
  marketingGoal?: string;
}

export interface UpdateContentItemDto {
  title?: string;
  sourceContent?: string | null;
  productInfo?: string | null;
  targetAudience?: string | null;
  marketingGoal?: string | null;
  status?: ContentItemStatus;
}

export interface CreateContentVersionDto {
  platform: Platform;
  contentType: ContentType;
  title?: string;
  body?: string;
  editedBy?: string;
  tags?: unknown;
  topics?: unknown;
  settings?: unknown;
}

export interface GenerateSingleVersionDto {
  platform: Platform;
  contentType: ContentType;
  title?: string;
}

export interface GenerateVersionsDto {
  organizationId: string;
  versions: GenerateSingleVersionDto[];
}
