import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PublishController } from "./publish.controller";
import { PublishWorkerController } from "./publish-worker.controller";
import { PublishService } from "./publish.service";
import { PublishQueueService } from "./publish-queue.service";

@Module({
  imports: [PrismaModule],
  controllers: [PublishController, PublishWorkerController],
  providers: [PublishService, PublishQueueService],
})
export class PublishModule {}
