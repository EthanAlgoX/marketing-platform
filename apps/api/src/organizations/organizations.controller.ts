import { Body, Controller, Get, Param, Post } from "@nestjs/common";
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
  addMember(@Param("organizationId") organizationId: string, @Body() body: AddMemberDto) {
    return this.organizationsService.addMember({
      organizationId,
      userId: body.userId,
      role: body.role,
    });
  }
}
