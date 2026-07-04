import { Headers, Controller, Post, Get, Param, Body, Query, Patch } from "@nestjs/common";
import { USER_ID_HEADER, resolveUserId } from "../common/access";
import {
  CreateContentItemDto,
  CreateContentVersionDto,
  UpdateContentItemDto,
} from "./content.dto";
import { ContentService } from "./content.service";

@Controller("content")
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  create(
    @Headers(USER_ID_HEADER) actingUserId: string,
    @Body() body: CreateContentItemDto,
  ) {
    const user = resolveUserId(actingUserId);
    return this.contentService.create({
      ...body,
      createdBy: body.createdBy ?? user.userId,
    });
  }

  @Get()
  list(@Query("organizationId") organizationId?: string) {
    return this.contentService.findAll({ organizationId });
  }

  @Get(":id")
  get(@Param("id") id: string, @Query("organizationId") organizationId?: string) {
    return this.contentService.findById(id, organizationId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: UpdateContentItemDto) {
    return this.contentService.update(id, body);
  }

  @Post(":id/versions")
  createVersion(
    @Param("id") contentItemId: string,
    @Headers(USER_ID_HEADER) actingUserId: string,
    @Body() body: CreateContentVersionDto,
  ) {
    const user = resolveUserId(actingUserId);
    return this.contentService.createVersion({
      ...body,
      contentItemId,
      editedBy: user.userId,
    });
  }
}
