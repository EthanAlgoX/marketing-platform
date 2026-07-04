import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { USER_ID_HEADER, resolveUserId } from "../common/access";
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
  addMember(
    @Param("organizationId") organizationId: string,
    @Headers(USER_ID_HEADER) actingUserId: string,
    @Body() body: AddMemberDto,
  ) {
    const user = resolveUserId(actingUserId);

    return this.organizationsService.addMember({
      actingUserId: user.userId,
      organizationId,
      ...body,
    });
  }

  @Get(":organizationId/members")
  members(@Param("organizationId") organizationId: string) {
    return this.organizationsService.members(organizationId);
  }
}
