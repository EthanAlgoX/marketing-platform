import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserId } from "../common/access";
import { RequireUserIdGuard } from "../common/require-user-id.guard";
import { OrganizationAccess, OrganizationAccessGuard } from "../common/organization-access.guard";
import { AddMemberDto, CreateOrganizationDto } from "./organizations.dto";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@Body() body: CreateOrganizationDto) {
    return this.organizationsService.create(body);
  }

  @Get()
  list() {
    return this.organizationsService.findAll();
  }

  @Post(":organizationId/members")
  @UseGuards(RequireUserIdGuard, OrganizationAccessGuard, OrganizationAccess({ role: "admin", organizationIdParam: "organizationId" }))
  addMember(
    @Param("organizationId") organizationId: string,
    @CurrentUserId() actingUserId: string,
    @Body() body: AddMemberDto,
  ) {
    return this.organizationsService.addMember({
      actingUserId,
      organizationId,
      ...body,
    });
  }

  @Get(":organizationId/members")
  @UseGuards(RequireUserIdGuard, OrganizationAccessGuard, OrganizationAccess({ role: "member", organizationIdParam: "organizationId" }))
  members(@Param("organizationId") organizationId: string) {
    return this.organizationsService.members(organizationId);
  }
}
