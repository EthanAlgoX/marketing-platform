import { OrganizationRole } from "../../../../packages/database/src";

export interface CreateOrganizationDto {
  name: string;
  ownerUserId?: string;
  ownerEmail?: string;
}

export interface AddMemberDto {
  userId: string;
  role?: OrganizationRole;
}
