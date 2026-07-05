import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/access";
import { RequireUserIdGuard } from "../common/require-user-id.guard";
import {
  CreatePublishTaskDto,
  PublishTargetManualCompleteDto,
} from "./publish.dto";
import { PublishService } from "./publish.service";

@Controller("publish-tasks")
@UseGuards(RequireUserIdGuard)
export class PublishController {
  constructor(@Inject(PublishService) private readonly publishService: PublishService) {}

  @Post()
  create(@CurrentUserId() actorUserId: string, @Body() body: CreatePublishTaskDto) {
    return this.publishService.createTask({
      ...body,
      actorUserId,
    });
  }

  @Get()
  list(@CurrentUserId() actorUserId: string, @Query("organizationId") organizationId?: string) {
    return this.publishService.findAll({ organizationId, actorUserId });
  }

  @Get(":id")
  get(@CurrentUserId() actorUserId: string, @Param("id") id: string) {
    return this.publishService.findById(id, actorUserId);
  }

  @Post(":id/run")
  run(@CurrentUserId() actorUserId: string, @Param("id") taskId: string) {
    return this.publishService.run(taskId, actorUserId);
  }

  @Patch(":taskId/targets/:targetId/manual-complete")
  completeManual(
    @CurrentUserId() actorUserId: string,
    @Param("taskId") taskId: string,
    @Param("targetId") targetId: string,
    @Body() body: PublishTargetManualCompleteDto,
  ) {
    return this.publishService.completeManualTarget(taskId, targetId, actorUserId, body);
  }
}
