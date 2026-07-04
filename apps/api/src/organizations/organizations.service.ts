import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { OrganizationMemberStatus, OrganizationRole } from "../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
import { canManageOrganizationMembers } from "../common/access";
import { CreateOrganizationDto } from "./organizations.dto";

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrganizationDto) {
    const data: { name: string } = {
      name: dto.name,
    };

    const organization = await this.prisma.organization.create({
      data,
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    let ownerId = dto.ownerUserId;
    if (!ownerId && dto.ownerEmail) {
      const ownerUser =
        (await this.prisma.user.findUnique({ where: { email: dto.ownerEmail } })) ??
        (await this.prisma.user.create({
          data: {
            email: dto.ownerEmail,
            passwordHash: "temporary-placeholder-hash",
          },
        }));
      ownerId = ownerUser.id;
    }

    if (ownerId) {
      await this.prisma.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: ownerId,
          role: OrganizationRole.owner,
        },
      });
    }

    return this.findById(organization.id);
  }

  findAll() {
    return this.prisma.organization.findMany({
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async addMember({
    organizationId,
    actingUserId,
    userId,
    role,
  }: {
    organizationId: string;
    actingUserId: string;
    userId: string;
    role?: OrganizationRole;
  }) {
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: actingUserId,
        },
      },
    });

    if (!member) {
      throw new HttpException("acting user not member of organization", HttpStatus.NOT_FOUND);
    }

    if (!canManageOrganizationMembers(member.role)) {
      throw new HttpException("insufficient permissions", HttpStatus.FORBIDDEN);
    }

    return this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId,
        role: role ?? OrganizationRole.member,
      },
      include: { user: true, organization: true },
    });
  }

  members(organizationId: string) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId, status: OrganizationMemberStatus.active },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  findById(id: string) {
    return this.prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });
  }
}
