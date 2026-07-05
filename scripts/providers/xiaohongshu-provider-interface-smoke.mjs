import path from "node:path";
import providers from "../../packages/providers/dist/index.js";

const { getProvider } = providers;

const provider = getProvider("xiaohongshu");

const MOCK_BIN_DIR = path.join(process.cwd(), "scripts", "providers", "mock-bin");
const cliCommand = (name) => path.join(MOCK_BIN_DIR, name);

const BASE_CONTENT = {
  id: "cv-001",
  title: "小红书自动发布冒烟测试",
  body: "这是内容正文，用于接口行为验证。",
  platform: "xiaohongshu",
  contentType: "note",
  tags: ["测试", "xhs"],
  topics: ["接口"],
  settings: {},
  media: [{ path: "media/image-001.png", mediaAsset: { path: "media/image-002.png" } }],
};

function buildRequest(overrides = {}) {
  return {
    organizationId: "org-001",
    platformAccount: {
      id: "acc-001",
      displayName: "小红书测试账号",
      platform: "xiaohongshu",
      username: "xhs_demo",
      accessType: "official_api",
      accessToken: "token-abc",
      settings: {},
      ...overrides.platformAccount,
    },
    contentVersion: {
      ...BASE_CONTENT,
      ...overrides.contentVersion,
    },
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withMockFetch(handler, runner) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    return handler({
      url: typeof url === "string" ? url : `${url}`,
      init,
    });
  };

  try {
    return await runner();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withEnv(name, value, cb) {
  const prev = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return await cb();
  } finally {
    if (prev === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prev;
    }
  }
}

async function runScenario(name, runner, expectation) {
  try {
    const result = await runner();
    if (expectation?.assert) {
      expectation.assert(result);
    }
    console.log(`✅ ${name}:`, JSON.stringify(result));
    return { name, ok: true, result };
  } catch (error) {
    console.log(`❌ ${name}:`, error.message);
    return { name, ok: false, error };
  }
}

const results = [];

results.push(
  await runScenario(
    "manual_no_token_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "manual",
            accessToken: undefined,
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "manual_required", "期望 manual_required");
        assert(!!result.manualInstruction, "期望返回 manualInstruction");
      },
    },
  ),
);

results.push(
  await runScenario(
    "bridge_missing_config_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            accessToken: "token-abc",
            settings: {},
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "manual_required", "期望 manual_required");
      },
    },
  ),
);

results.push(
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ id: "note-bridge-ok", url: "https://mock.xiaohongshu.com/p/bridge-ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_publish_success_should_return_published",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/api/xiaohongshu/publish",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "note-bridge-ok", "期望返回 note id");
            assert(result.externalUrl === "https://mock.xiaohongshu.com/p/bridge-ok", "期望返回外链");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ message: "token invalid" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_401_should_return_manual_required",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/api/xiaohongshu/publish",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "manual_required", "期望 manual_required");
            assert(!!result.manualInstruction, "期望返回 manualInstruction");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    async () =>
      new Response("not-json-response", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    () =>
      runScenario(
        "bridge_non_json_should_return_failed",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/api/xiaohongshu/publish",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/非 JSON/.test(result.errorMessage || ""), "应包含非 JSON 信息");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ message: "ok but no id/url" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_success_without_result_should_return_failed",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/api/xiaohongshu/publish",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/未识别到/.test(result.errorMessage || ""), "应包含未识别到 id/url 信息");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    async ({ init }) =>
      new Promise((_, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          reject(new DOMException("This operation was aborted", "AbortError"));
          return;
        }
        const onAbort = () => reject(new DOMException("This operation was aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
    () =>
      runScenario(
        "bridge_timeout_should_return_failed",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/api/xiaohongshu/publish",
                  cliTimeoutMs: 250,
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/发布网关请求失败/.test(result.errorMessage || ""), "应命名为网关请求失败");
          },
        },
      ),
  ),
);

results.push(
  await runScenario(
    "cli_success_should_return_published",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("xiaohongshu-cli-success.sh"),
              cliTimeoutMs: 1000,
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "published", "期望 published");
        assert(result.providerPostId === "note-cli-success-001", "应返回 note id");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_exit_1_should_return_manual_required",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("xiaohongshu-cli-fail.sh"),
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "manual_required", "期望 manual_required");
        assert(/退出码:\s*1/.test(result.manualInstruction?.steps?.[0] || ""), "应返回 CLI 退出码");
        assert(!!result.manualInstruction, "应返回 manualInstruction");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_non_json_output_should_return_manual_required",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("xiaohongshu-cli-nojson.sh"),
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "manual_required", "期望 manual_required");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_timeout_should_return_failed",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("xiaohongshu-cli-slow.sh"),
              cliTimeoutMs: "1100",
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "failed", "期望 failed");
        assert(/CLI 调用超时/.test(result.errorMessage || ""), "应返回超时提示");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_missing_command_should_return_manual_required",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("xiaohongshu-cli-not-exist.sh"),
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "manual_required", "期望 manual_required");
      },
    },
  ),
);

await withEnv("XIAOHONGSHU_PUBLISH_MODE", "bridge", async () =>
  await withEnv("XIAOHONGSHU_PUBLISH_GATEWAY_URL", "https://mock-gateway-from-env.localhost/api/xiaohongshu/publish", async () => {
    const tokenProvider = withMockFetch(async () =>
      new Response(JSON.stringify({ data: { noteId: "note-env-bridge" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "env_publish_mode_bridge_fallback_with_defaults",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessToken: undefined,
                token: "env-token",
                settings: {},
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "note-env-bridge", "应从 data.noteId 识别到 id");
          },
        },
      ),
    );
    results.push(await tokenProvider);
  }),
);

const failed = results.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} 个用例失败：`);
  for (const item of failed) {
    console.error(`- ${item.name}`);
  }
  process.exit(1);
}

console.log(`\n全部完成：通过 ${results.length} / ${results.length} 用例`);
