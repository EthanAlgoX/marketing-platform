#!/usr/bin/env node

const API_BASE = (process.env.MARKETING_API_BASE ?? "http://localhost:4000/api").replace(/\/$/, "");
const API_TIMEOUT_MS = Number.parseInt(process.env.MARKETING_LOOP_TIMEOUT_MS ?? "120000", 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.MARKETING_LOOP_POLL_INTERVAL_MS ?? "1500", 10);
const USER_EMAIL = process.env.MARKETING_LOOP_EMAIL ?? `loop-${Date.now()}@example.com`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiRequest(path, init = {}, withUser = true) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    "content-type": "application/json",
    ...(withUser && apiContext.userId ? { "x-user-id": apiContext.userId } : {}),
    ...(init.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${init.method || "GET"} ${url} request failed: ${message}`);
  }
  clearTimeout(timeout);

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.message ?? `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`${init.method || "GET"} ${path} failed: ${message}`);
  }

  return payload;
}

const apiContext = {
  userId: "",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function waitForCompletion(taskId) {
  const startAt = Date.now();
  while (Date.now() - startAt < API_TIMEOUT_MS) {
    const task = await apiRequest(`/publish-tasks/${taskId}`);

    const terminalTargetStatuses = new Set(["success", "failed", "manual_required", "skipped", "canceled"]);
    const allTargetCompleted = task.targets.every((target) => terminalTargetStatuses.has(target.status));
    const taskRunning = task.status === "processing" || task.status === "draft" || task.status === "scheduled";
    if (allTargetCompleted && !taskRunning) {
      return task;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`publish task ${taskId} did not finish within timeout`);
}

async function main() {
  console.log(`[1/7] create user: ${USER_EMAIL}`);
  const user = await apiRequest(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({ email: USER_EMAIL }),
    },
    false,
  );
  apiContext.userId = user.id;
  console.log(`[1/7] userId=${user.id}`);

  console.log("[2/7] create organization");
  const org = await apiRequest(
    "/organizations",
    {
      method: "POST",
      body: JSON.stringify({
        name: `Loop Org ${Date.now()}`,
        ownerUserId: user.id,
      }),
    },
    false,
  );
  const organizationId = org.id;
  console.log(`[2/7] organizationId=${organizationId}`);

  console.log("[3/7] create content");
  const item = await apiRequest(
    "/content",
    {
      method: "POST",
      body: JSON.stringify({
        organizationId,
        title: "闭环验收测试内容",
        sourceContent: "这是一条用于 loop 验收的原始营销内容，包含价值主张和用户场景。",
        productInfo: "营销发布平台",
        targetAudience: "产品运营",
        marketingGoal: "提升试用转化",
      }),
    },
  );
  console.log(`[3/7] contentId=${item.id}`);

  console.log("[4/7] generate three platform versions");
  const versionResp = await apiRequest(`/content/${item.id}/versions/ai`, {
    method: "POST",
    body: JSON.stringify({
      organizationId,
      versions: [
        { platform: "xiaohongshu", contentType: "note", title: "小红书版本" },
        { platform: "zhihu", contentType: "article", title: "知乎版本" },
        { platform: "x_twitter", contentType: "tweet", title: "X 版本" },
      ],
    }),
  });
  assert(Array.isArray(versionResp.createdVersions), "createdVersions 应返回");
  assert(versionResp.createdVersions.length === 3, "应生成 3 个版本");

  const versionByPlatform = {};
  for (const version of versionResp.createdVersions) {
    versionByPlatform[version.platform] = version.id;
  }
  console.log("[4/7] version ids:", versionResp.createdVersions.map((item) => `${item.platform}:${item.id}`).join(", "));

  console.log("[5/7] create platform accounts");
  const accounts = [];
  for (const platform of ["xiaohongshu", "zhihu", "x_twitter"]) {
    const account = await apiRequest("/platform-accounts", {
      method: "POST",
      body: JSON.stringify({
        organizationId,
        platform,
        displayName: `${platform} loop account`,
        accessType: "manual",
        authStatus: "active",
      }),
    });
    accounts.push(account);
  }
  const accountByPlatform = Object.fromEntries(accounts.map((account) => [account.platform, account.id]));
  console.log("[5/7] accounts created:", accounts.map((item) => `${item.platform}/${item.id}`).join(", "));

  console.log("[6/7] create publish task");
  const task = await apiRequest("/publish-tasks", {
    method: "POST",
    body: JSON.stringify({
      organizationId,
      contentItemId: item.id,
      targets: Object.keys(versionByPlatform).map((platform) => ({
        platformAccountId: accountByPlatform[platform],
        contentVersionId: versionByPlatform[platform],
      })),
    }),
  });
  console.log(`[6/7] taskId=${task.id}`);

  console.log("[6/7] execute publish task");
  await apiRequest(`/publish-tasks/${task.id}/run`, {
    method: "POST",
    body: "{}",
  });

  console.log("[7/7] poll first execution result");
  const inFlight = await waitForCompletion(task.id);
  assert(inFlight.targets.length === 3, "发布任务应包含 3 个 target");
  const hasManualRequired = inFlight.targets.some((target) => target.status === "manual_required");
  assert(hasManualRequired, "未配置真实平台凭据时，应至少出现一个 manual_required");
  const allFirstRunTerminal = inFlight.targets.every((target) =>
    ["success", "failed", "manual_required", "skipped", "canceled"].includes(target.status),
  );
  assert(allFirstRunTerminal, `首次执行后所有 target 应进入终态或人工处理态，实际：${inFlight.targets.map((target) => target.status).join(",")}`);
  console.log("first execution:", JSON.stringify(inFlight.targets.map((item) => `${item.platform}:${item.status}`), null, 2));

  const manualTargets = inFlight.targets.filter((target) => target.status === "manual_required");
  if (manualTargets.length > 0) {
    console.log(`[7/7] fill ${manualTargets.length} 个 manual_required target`);
    for (const target of manualTargets) {
      await apiRequest(`/publish-tasks/${task.id}/targets/${target.id}/manual-complete`, {
        method: "PATCH",
        body: JSON.stringify({
          externalUrl: `https://example.com/publish/${task.id}/${target.id}`,
          providerPostId: `manual-${target.platform}-${Date.now()}`,
          note: "loop smoke test manual fill",
        }),
      }, true);
    }
  }

  const finalTask = await waitForCompletion(task.id);
  const finalSuccess = finalTask.targets.every((target) => target.status === "success");
  assert(finalSuccess, `最终所有 target 应为 success，实际：${finalTask.targets.map((target) => target.status).join(",")}`);

  console.log("DONE", finalTask.id, finalTask.status);
  finalTask.targets.forEach((target) => {
    console.log(`- ${target.platform}: ${target.status} (${target.externalUrl ?? ""}${target.result?.externalUrl ?? ""})`);
  });
}

main()
  .then(() => {
    console.log("publish loop smoke test passed");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
