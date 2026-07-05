import { Body, Controller, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { RequireUserIdGuard } from "../common/require-user-id.guard";
import { CurrentUserId } from "../common/access";
import { CreatePlatformAccountDto } from "./platform-accounts.dto";
import { PlatformAccountsService } from "./platform-accounts.service";

@Controller("platform-accounts")
@UseGuards(RequireUserIdGuard)
export class PlatformAccountsController {
  constructor(@Inject(PlatformAccountsService) private readonly platformAccountsService: PlatformAccountsService) {}

  @Post()
  create(@CurrentUserId() actorUserId: string, @Body() body: CreatePlatformAccountDto) {
    return this.platformAccountsService.create({
      ...body,
      actorUserId,
    });
  }

  @Get()
  list(@Query("organizationId") organizationId: string, @CurrentUserId() actorUserId: string) {
    return this.platformAccountsService.findByOrganizationId({ organizationId, actorUserId });
  }
}
