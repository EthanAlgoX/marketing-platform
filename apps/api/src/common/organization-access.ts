import { HttpException, HttpStatus } from "@nestjs/common";
import { OrganizationMemberStatus, OrganizationRole, PrismaClient } from "../../../../packages/database/src";
import { PrismaService } from "../prisma/prisma.service";

export interface MembershipResult {
  role: OrganizationRole;
  status: OrganizationMemberStatus;
}

export async function assertActiveOrganizationMember(
  prisma: PrismaService | PrismaClient,
  organizationId: string,
  actorUserId: string,
) {
  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: actorUserId,
      },
    },
  });

  if (!member || member.status !== OrganizationMemberStatus.active) {
    throw new HttpException("acting user is not an active member of organization", HttpStatus.FORBIDDEN);
  }

  return { role: member.role, status: member.status } as MembershipResult;
}

export async function assertOrganizationManager(
  prisma: PrismaService | PrismaClient,
  organizationId: string,
  actorUserId: string,
) {
  const member = await assertActiveOrganizationMember(prisma, organizationId, actorUserId);

  if (member.role !== OrganizationRole.owner && member.role !== OrganizationRole.admin) {
    throw new HttpException("insufficient permissions", HttpStatus.FORBIDDEN);
  }

  return member;
}

export async function listActorOrganizationIds(
  prisma: PrismaService | PrismaClient,
  actorUserId: string,
): Promise<string[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId: actorUserId,
      status: OrganizationMemberStatus.active,
    },
    select: { organizationId: true },
  });

  return memberships.map((membership) => membership.organizationId);
}
