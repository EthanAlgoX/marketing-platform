import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { ContentModule } from "./content/content.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [PrismaModule, HealthModule, UsersModule, OrganizationsModule, ContentModule],
})
export class AppModule {}
