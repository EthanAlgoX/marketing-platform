import path from "node:path";
import providerModule from "../../packages/providers/dist/index.js";

const { getProvider } = providerModule;

const MOCK_BIN_DIR = path.join(process.cwd(), "scripts", "providers", "mock-bin");
const cliCommand = (name) => path.join(MOCK_BIN_DIR, name);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildInstructionTemplateAssertion(platform) {
  return (result) => {
    assert(result.status === "manual_required", `[${platform}] 应返回 manual_required`);
    assert(!!result.manualInstruction, `[${platform}] 应返回 manualInstruction`);

    const instruction = result.manualInstruction;
    assert(typeof instruction?.title === "string" && instruction.title.includes("CLI"), `[${platform}] title 应包含 CLI 语义`);
    assert(Array.isArray(instruction?.steps) && instruction.steps.length >= 3, `[${platform}] steps 应包含至少 3 项`);
    assert(
      Array.isArray(instruction?.checkList) && instruction.checkList.length >= 3,
      `[${platform}] checkList 应包含至少 3 项`,
    );
    assert(Array.isArray(instruction?.notes) && instruction.notes.length >= 1, `[${platform}] notes 应至少有 1 项`);
    assert(/退出码/.test(instruction.steps[0] || ""), `[${platform}] 应包含退出码信息`);
  };
}

function buildRequest({
  platform,
  contentType,
  platformAccountSettings,
}) {
  return {
    organizationId: "org-001",
    platformAccount: {
      id: "acc-001",
      displayName: `${platform} 测试账号`,
      platform,
      username: `${platform}_demo`,
      accessType: "official_api",
      accessToken: "token-abc",
      settings: {
        publishMode: "cli",
        ...platformAccountSettings,
      },
    },
    contentVersion: {
      id: `${platform}-cv-template-001`,
      title: `${platform} CLI 模板校验测试`,
      body: "这是用于自动化冒烟的发布正文。",
      platform,
      contentType,
      tags: ["模板", "CLI", platform],
      topics: ["接口"],
      settings: {
        questionId: platform === "zhihu" ? "https://www.zhihu.com/question/10086" : undefined,
      },
      media: [{ path: "media/image-001.png", mediaAsset: { path: "media/image-002.png" } }],
    },
  };
}

async function runScenario(name, runner, expectation) {
  try {
    const result = await runner();
    expectation?.(result);
    console.log(`✅ ${name}:`, JSON.stringify(result));
    return { name, ok: true, result };
  } catch (error) {
    console.log(`❌ ${name}:`, error.message);
    return { name, ok: false, error };
  }
}

const results = [];

const providers = [
  {
    id: "xiaohongshu",
    request: buildRequest({
      platform: "xiaohongshu",
      contentType: "note",
      platformAccountSettings: { cliCommand: cliCommand("xiaohongshu-cli-fail.sh") },
    }),
    assertion: buildInstructionTemplateAssertion("xiaohongshu"),
  },
  {
    id: "zhihu",
    request: buildRequest({
      platform: "zhihu",
      contentType: "article",
      platformAccountSettings: { cliCommand: cliCommand("zhihu-cli-fail.sh") },
    }),
    assertion: buildInstructionTemplateAssertion("zhihu"),
  },
  {
    id: "wechat_official_account",
    request: buildRequest({
      platform: "wechat_official_account",
      contentType: "article",
      platformAccountSettings: { cliCommand: cliCommand("wechat-cli-fail.sh") },
    }),
    assertion: buildInstructionTemplateAssertion("wechat_official_account"),
  },
];

for (const { id, request, assertion } of providers) {
  const provider = getProvider(id);
  results.push(
    await runScenario(
      `${id}_cli_failure_template_should_be_unified`,
      () => provider.publish(request),
      assertion,
    ),
  );
}

const failed = results.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} 个用例失败：`);
  for (const item of failed) {
    console.error(`- ${item.name}`);
  }
  process.exit(1);
}

console.log(`\n全部完成：通过 ${results.length} / ${results.length} 用例`);
