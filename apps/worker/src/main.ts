import { Worker, type WorkerOptions } from "bullmq";

interface PublishTaskJobData {
  taskId: string;
}

const queueName = process.env.PUBLISH_QUEUE_NAME ?? "publish-task-execution";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const apiUrl = process.env.API_URL ?? "http://localhost:4000/api";
const workerToken = process.env.PUBLISH_WORKER_TOKEN;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);

function resolveWorkerOptions(): WorkerOptions {
  return {
    connection: {
      url: redisUrl,
    },
    concurrency: Number.isNaN(concurrency) ? 2 : Math.max(1, concurrency),
  };
}

async function executeTask(taskId: string) {
  const response = await fetch(`${apiUrl}/publish-tasks/${taskId}/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workerToken ? { "x-worker-token": workerToken } : {}),
    },
    body: "{}",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`worker execute failed for task ${taskId}: ${response.status} ${message}`);
  }

  return response.text();
}

async function bootstrap() {
  const worker = new Worker(
    queueName,
    async (job) => {
      const payload = job.data as PublishTaskJobData;
      if (!payload?.taskId) {
        throw new Error("invalid publish task job payload");
      }

      await executeTask(payload.taskId);
      return { taskId: payload.taskId, queueName, processedAt: new Date().toISOString() };
    },
    resolveWorkerOptions(),
  );

  worker.on("ready", () => {
    console.log(`Marketing Platform worker is ready, listening on queue ${queueName}`);
  });

  worker.on("completed", (job) => {
    console.log(`Publish task processed by worker: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    const taskId = job?.data && typeof job.data === "object" && "taskId" in job.data ? String(job.data.taskId) : "unknown";
    console.error(`Publish worker failed for task ${taskId}:`, error);
  });

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void bootstrap();
