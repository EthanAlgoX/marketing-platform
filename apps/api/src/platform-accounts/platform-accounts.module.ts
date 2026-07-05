import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PlatformAccountsController } from "./platform-accounts.controller";
import { PlatformAccountsService } from "./platform-accounts.service";

@Module({
  imports: [PrismaModule],
  controllers: [PlatformAccountsController],
  providers: [PlatformAccountsService],
  exports: [PlatformAccountsService],
})
export class PlatformAccountsModule {}
