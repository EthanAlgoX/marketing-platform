import { HttpException, HttpStatus } from "@nestjs/common";
import { OrganizationRole } from "../../../packages/database/src";

export const USER_ID_HEADER = "x-user-id";

export interface UserContext {
  userId: string;
}

export function resolveUserId(userId?: string): UserContext {
  if (!userId || userId.trim().length === 0) {
    throw new HttpException("x-user-id is required", HttpStatus.BAD_REQUEST);
  }

  return { userId };
}

export function canManageOrganizationMembers(role: OrganizationRole): boolean {
  return role === OrganizationRole.owner || role === OrganizationRole.admin;
}
