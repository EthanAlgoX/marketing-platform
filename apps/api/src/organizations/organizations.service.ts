import { Injectable } from "@nestjs/common";
import { OrganizationRole } from "../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";
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
    userId,
    role,
  }: {
    organizationId: string;
    userId: string;
    role?: OrganizationRole;
  }) {
    return this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId,
        role: role ?? OrganizationRole.member,
      },
      include: { user: true, organization: true },
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
