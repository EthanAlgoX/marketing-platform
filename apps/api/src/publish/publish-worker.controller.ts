import { Controller, ForbiddenException, Headers, Inject, Param, Post } from "@nestjs/common";
import { PublishService } from "./publish.service";

@Controller("publish-tasks")
export class PublishWorkerController {
  constructor(@Inject(PublishService) private readonly publishService: PublishService) {}

  @Post(":id/execute")
  async executeByWorker(@Param("id") taskId: string, @Headers("x-worker-token") workerToken?: string) {
    const expectedToken = process.env.PUBLISH_WORKER_TOKEN;
    if (expectedToken && workerToken !== expectedToken) {
      throw new ForbiddenException("invalid worker token");
    }

    return this.publishService.executeNow(taskId);
  }
}
