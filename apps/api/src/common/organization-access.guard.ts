import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { assertActiveOrganizationMember, assertOrganizationManager } from "./organization-access";
import { PrismaService } from "../prisma/prisma.service";

export interface OrganizationAccessOptions {
  role: "member" | "admin";
  organizationIdParam?: "organizationId" | "id" | string;
}

export const ORGANIZATION_ACCESS_KEY = "organization-access";

export const OrganizationAccess = (options: OrganizationAccessOptions) => SetMetadata(ORGANIZATION_ACCESS_KEY, options);

export const OrganizationAccessUserId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest() as { userId?: string };
  if (!request.userId || typeof request.userId !== "string" || request.userId.trim().length === 0) {
    throw new UnauthorizedException("x-user-id is required");
  }

  return request.userId;
});

@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as {
      params?: Record<string, string>;
      query?: Record<string, string | undefined>;
      userId?: string;
    };

    const userId = request.userId;
    if (!userId) {
      throw new UnauthorizedException("x-user-id is required");
    }

    const options = this.reflector.get<OrganizationAccessOptions>(ORGANIZATION_ACCESS_KEY, context.getHandler()) ??
      this.reflector.get<OrganizationAccessOptions>(ORGANIZATION_ACCESS_KEY, context.getClass()) ??
      { role: "member" };
    const paramName = options.organizationIdParam ?? "organizationId";

    const organizationId = request.params?.[paramName] ?? request.query?.[paramName];
    if (!organizationId) {
      throw new UnauthorizedException("organizationId is required");
    }

    if (options.role === "admin") {
      await assertOrganizationManager(this.prisma, organizationId, userId);
    } else {
      await assertActiveOrganizationMember(this.prisma, organizationId, userId);
    }

    return true;
  }
}
