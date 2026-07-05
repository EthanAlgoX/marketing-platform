import { Injectable, InternalServerErrorException, OnModuleDestroy } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";

interface PublishQueuePayload {
  taskId: string;
}

@Injectable()
export class PublishQueueService implements OnModuleDestroy {
  private readonly queue: Queue<PublishQueuePayload>;

  constructor() {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const queueName = process.env.PUBLISH_QUEUE_NAME ?? "publish-task-execution";

    this.queue = new Queue(queueName, {
      connection: { url: redisUrl },
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    });
  }

  async enqueueRun(taskId: string) {
    if (!taskId || taskId.trim().length === 0) {
      throw new InternalServerErrorException("taskId is required");
    }

    const jobOptions: JobsOptions = {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    };

    const jobId = `publish-task-${taskId}`;
    try {
      const job = await this.queue.add("run", { taskId }, { ...jobOptions, jobId });
      return {
        queue: this.queue.name,
        jobId: job.id,
      };
    } catch (error) {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        return {
          queue: this.queue.name,
          jobId: existing.id ?? jobId,
        };
      }
      throw error;
    }
  }

  onModuleDestroy() {
    return this.queue.close();
  }
}
