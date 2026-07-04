import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { ContentModule } from "./content/content.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { RequireUserIdGuard } from "./common/require-user-id.guard";

@Module({
  imports: [PrismaModule, HealthModule, UsersModule, OrganizationsModule, ContentModule],
  providers: [RequireUserIdGuard],
})
export class AppModule {}
