import path from "node:path";
import providers from "../../packages/providers/dist/index.js";

const { getProvider } = providers;

const provider = getProvider("zhihu");

const MOCK_BIN_DIR = path.join(process.cwd(), "scripts", "providers", "mock-bin");
const cliCommand = (name) => path.join(MOCK_BIN_DIR, name);

const BASE_CONTENT = {
  id: "cv-zhihu-001",
  title: "知乎自动发布冒烟测试",
  body: "这是内容正文，用于接口行为验证。",
  platform: "zhihu",
  contentType: "article",
  tags: ["测试", "zhihu"],
  topics: ["接口"],
  settings: {},
  media: [{ path: "media/image-001.png", mediaAsset: { path: "media/image-002.png" } }],
};

function buildRequest(overrides = {}) {
  return {
    organizationId: "org-001",
    platformAccount: {
      id: "acc-001",
      displayName: "知乎测试账号",
      platform: "zhihu",
      username: "zhihu_demo",
      accessType: "official_api",
      accessToken: "token-abc",
      settings: {},
      ...overrides.platformAccount,
    },
    contentVersion: {
      ...BASE_CONTENT,
      ...overrides.contentVersion,
      settings: {
        ...(BASE_CONTENT.settings || {}),
        ...(overrides.contentVersion?.settings || {}),
      },
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
      new Response(JSON.stringify({ id: "zhihu-article-bridge-ok", url: "https://mock.zhihu.com/p/article-bridge-ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_publish_article_success",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
                  createArticlePath: "/zhihu-mcp-server/create_article",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "zhihu-article-bridge-ok", "期望返回文章 id");
            assert(result.externalUrl === "https://mock.zhihu.com/p/article-bridge-ok", "期望返回外链");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    async () =>
      new Response(JSON.stringify({ id: "zhihu-answer-bridge-ok", url: "https://mock.zhihu.com/p/answer-bridge-ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_publish_answer_success_with_question_id",
        () =>
          provider.publish(
            buildRequest({
              contentVersion: {
                contentType: "answer",
                title: "知乎回答标题",
                settings: {
                  questionId: "10086",
                },
              },
              platformAccount: {
                accessType: "official_api",
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
                  createAnswerPath: "/zhihu-mcp-server/create_answer",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "zhihu-answer-bridge-ok", "期望返回回答 id");
          },
        },
      ),
  ),
);

results.push(
  await runScenario(
    "bridge_answer_without_question_id_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          contentVersion: {
            contentType: "answer",
            settings: {},
          },
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "bridge",
              publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
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
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "manual_required", "期望 manual_required");
            assert(!!result.manualInstruction, "应返回 manualInstruction");
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
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
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
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/未识别到/.test(result.errorMessage || ""), "应包含未识别到结果信息");
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
                  publishGatewayUrl: "https://mock-gateway.localhost/zhihu-mcp-server",
                  cliTimeoutMs: 250,
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/网关请求超时/.test(result.errorMessage || ""), "应命名为网关请求超时");
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
              cliCommand: cliCommand("zhihu-cli-success.sh"),
              cliTimeoutMs: 1000,
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "published", "期望 published");
        assert(result.providerPostId === "zhihu-cli-article-001", "应返回文章 id");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_answer_with_question_id_should_return_published",
    () =>
      provider.publish(
        buildRequest({
          contentVersion: {
            contentType: "answer",
            settings: {
              questionId: "https://www.zhihu.com/question/10086/answer/20002",
            },
          },
          platformAccount: {
            accessType: "official_api",
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("zhihu-cli-success.sh"),
              cliTimeoutMs: 1000,
            },
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "published", "期望 published");
        assert(result.providerPostId === "zhihu-cli-answer-001", "应返回回答 id（通过 CLI）");
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
              cliCommand: cliCommand("zhihu-cli-fail.sh"),
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
              cliCommand: cliCommand("zhihu-cli-nojson.sh"),
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
              cliCommand: cliCommand("zhihu-cli-slow.sh"),
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
              cliCommand: cliCommand("zhihu-cli-not-exist.sh"),
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

await withEnv("ZHIHU_PUBLISH_MODE", "bridge", async () =>
  await withEnv("ZHIHU_PUBLISH_GATEWAY_URL", "https://mock-gateway-from-env.localhost/zhihu-mcp-server", async () => {
    const tokenProvider = withMockFetch(
      async () =>
        new Response(JSON.stringify({ data: { id: "zhihu-env-bridge" } }), {
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
              assert(result.providerPostId === "zhihu-env-bridge", "应从 data.id 识别到 id");
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
