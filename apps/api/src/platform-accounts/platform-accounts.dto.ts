import { Platform, PlatformAccessType, PlatformAuthStatus } from "../../../../packages/database/src";

export interface CreatePlatformAccountDto {
  organizationId: string;
  platform: Platform;
  displayName: string;
  username?: string;
  providerAccountId?: string;
  tokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  tokenExpiresAt?: string;
  settings?: unknown;
  accessType?: PlatformAccessType;
  authStatus?: PlatformAuthStatus;
}
