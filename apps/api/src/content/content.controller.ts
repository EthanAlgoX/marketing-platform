import { Controller, Post, Get, Param, Body, Query, Patch, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/access";
import { RequireUserIdGuard } from "../common/require-user-id.guard";
import {
  CreateContentItemDto,
  CreateContentVersionDto,
  UpdateContentItemDto,
} from "./content.dto";
import { ContentService } from "./content.service";

@Controller("content")
@UseGuards(RequireUserIdGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() body: CreateContentItemDto) {
    return this.contentService.create({
      ...body,
      actorUserId: userId,
    });
  }

  @Get()
  list(@CurrentUserId() userId: string, @Query("organizationId") organizationId?: string) {
    return this.contentService.findAll({ organizationId, actorUserId: userId });
  }

  @Get(":id")
  get(
    @Param("id") id: string,
    @CurrentUserId() userId: string,
    @Query("organizationId") organizationId?: string,
  ) {
    return this.contentService.findById(id, { organizationId, actorUserId: userId });
  }

  @Patch(":id")
  update(@Param("id") id: string, @CurrentUserId() userId: string, @Body() body: UpdateContentItemDto) {
    return this.contentService.update(id, body, userId);
  }

  @Post(":id/versions")
  createVersion(@Param("id") contentItemId: string, @CurrentUserId() userId: string, @Body() body: CreateContentVersionDto) {
    return this.contentService.createVersion({
      ...body,
      contentItemId,
      editedBy: userId,
      actorUserId: userId,
    });
  }
}
