import path from "node:path";
import providers from "../../packages/providers/dist/index.js";

const { getProvider } = providers;

const provider = getProvider("wechat_official_account");

const MOCK_BIN_DIR = path.join(process.cwd(), "scripts", "providers", "mock-bin");
const cliCommand = (name) => path.join(MOCK_BIN_DIR, name);

const BASE_CONTENT = {
  id: "cv-wechat-001",
  title: "微信公众号自动发布冒烟测试",
  body: "这是内容正文，用于接口行为验证。",
  platform: "wechat_official_account",
  contentType: "article",
  tags: ["测试", "公众号", "weixin"],
  topics: ["接口"],
  settings: {},
  media: ["media/image-001.png"],
};

function buildRequest(overrides = {}) {
  return {
    organizationId: "org-001",
    platformAccount: {
      id: "acc-001",
      displayName: "公众号测试账号",
      platform: "wechat_official_account",
      username: "wx_demo",
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

function withSequenceResponse(handlers, runner) {
  let called = 0;
  return withMockFetch(({ url, init }) => {
    const handler = handlers[called++];
    if (!handler) {
      return new Response(JSON.stringify({ message: "mocked response not enough" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    if (typeof handler === "function") {
      return handler({ url, init, called });
    }
    return handler;
  }, runner);
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
    "manual_should_return_manual_required_without_token",
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
    "bridge_missing_gateway_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            accessType: "official_api",
            accessToken: undefined,
            settings: {
              publishMode: "bridge",
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
  await withSequenceResponse(
    [
      new Response(JSON.stringify({ access_token: "mock-token-01" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      ({ url }) => {
        assert(url.includes("/cgi-bin/draft/add"), "应请求草稿创建接口");
        return new Response(JSON.stringify({ media_id: "wechat-media-001", publish_id: "wechat-publish-draft" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      ({ url }) => {
        assert(url.includes("/cgi-bin/freepublish/submit"), "应请求发布提交接口");
        return new Response(JSON.stringify({ publish_id: "wechat-publish-001", url: "https://mp.weixin.qq.com/p/wechat-publish-001" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ],
    () =>
      runScenario(
        "direct_publish_should_return_published",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessType: "official_api",
                accessToken: undefined,
                token: undefined,
                settings: {
                  appId: "wx-app-id",
                  appSecret: "wx-app-secret",
                  publishMode: "direct",
                },
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "wechat-publish-001", "应返回 publish id");
            assert(
              result.externalUrl === "https://mp.weixin.qq.com/p/wechat-publish-001",
              "应返回发布链接",
            );
          },
        },
      ),
  ),
);

results.push(
  await withSequenceResponse(
    [
      new Response(JSON.stringify({ errcode: 40001, errmsg: "invalid appsecret" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
    () =>
      runScenario(
        "token_error_should_return_manual_required",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                accessToken: undefined,
                token: undefined,
                settings: {
                  appId: "wx-app-id",
                  appSecret: "wx-bad-secret",
                  publishMode: "direct",
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
    () =>
      new Response(JSON.stringify({ publish_id: "wechat-bridge-001", url: "https://mock.wechat.bridge/p/bridge-001" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    () =>
      runScenario(
        "bridge_publish_success",
        () =>
          provider.publish(
            buildRequest({
              platformAccount: {
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/wechat-publish",
                },
                accessToken: undefined,
                token: undefined,
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "published", "期望 published");
            assert(result.providerPostId === "wechat-bridge-001", "应返回 bridge publish id");
            assert(result.externalUrl === "https://mock.wechat.bridge/p/bridge-001", "应返回外链");
          },
        },
      ),
  ),
);

results.push(
  await withMockFetch(
    () =>
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
                settings: {
                  publishMode: "bridge",
                  publishGatewayUrl: "https://mock-gateway.localhost/wechat-publish",
                },
                accessToken: undefined,
                token: undefined,
              },
            }),
          ),
        {
          assert: (result) => {
            assert(result.status === "failed", "期望 failed");
            assert(/非 JSON/.test(result.errorMessage || ""), "应包含非 JSON 提示");
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
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("wechat-cli-success.sh"),
            },
            accessToken: undefined,
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "published", "期望 published");
        assert(result.providerPostId === "wechat-cli-001", "应返回 cli id");
      },
    },
  ),
);

results.push(
  await runScenario(
    "cli_command_fail_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("wechat-cli-fail.sh"),
            },
            accessToken: undefined,
          },
        }),
      ),
      {
        assert: (result) => {
          assert(result.status === "manual_required", "期望 manual_required");
          assert(/退出码: 1/.test(result.manualInstruction?.steps?.[0] || ""), "应返回 CLI 退出码");
          assert(!!result.manualInstruction, "应返回 manualInstruction");
        },
      },
    ),
);

results.push(
  await runScenario(
    "cli_json_invalid_should_return_manual",
    () =>
      provider.publish(
        buildRequest({
          platformAccount: {
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("wechat-cli-nojson.sh"),
            },
            accessToken: undefined,
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
            settings: {
              publishMode: "cli",
              cliCommand: cliCommand("wechat-cli-slow.sh"),
              cliTimeoutMs: 1200,
            },
            accessToken: undefined,
          },
        }),
      ),
    {
      assert: (result) => {
        assert(result.status === "failed", "期望 failed");
        assert(/超时/.test(result.errorMessage || ""), "应包含超时提示");
      },
    },
  ),
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
