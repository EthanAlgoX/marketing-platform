// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { createHmac, randomBytes } from "crypto";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { spawn } from "child_process";

export type ProviderPlatform = "xiaohongshu" | "zhihu" | "wechat_official_account" | "x_twitter";

export type ProviderPublishOutcome = "published" | "manual_required" | "failed";

export type ProviderCapabilities = {
  publish: boolean;
  draft: boolean;
  mediaUpload: boolean;
  schedule: boolean;
  metrics: boolean;
  manualInstruction: boolean;
};

export interface PublishProfile {
  id: string;
  displayName: string;
  platform: ProviderPlatform;
  username?: string | null;
  accessToken?: string | null;
  accessTokenSecret?: string | null;
  tokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  accessType?: string | null;
  tokenExpiresAt?: string | null;
  token?: string | null;
  settings?: unknown;
}

export interface ContentVersionProfile {
  id: string;
  title: string | null;
  body: string | null;
  platform: ProviderPlatform;
  contentType: string;
  tags?: unknown;
  topics?: unknown;
  settings?: unknown;
  media?: unknown;
}

export interface PublishManualInstruction {
  title: string;
  steps: string[];
  checkList?: string[];
  notes?: string[];
}

export interface PublishRequest {
  organizationId: string;
  platformAccount: PublishProfile;
  contentVersion: ContentVersionProfile;
}

export interface PublishResponse {
  status: ProviderPublishOutcome;
  providerPostId?: string;
  externalUrl?: string;
  manualInstruction?: PublishManualInstruction;
  errorMessage?: string;
}

export interface PublishProvider {
  readonly platform: ProviderPlatform;
  readonly capabilities: ProviderCapabilities;
  publish(request: PublishRequest): Promise<PublishResponse>;
}

abstract class BaseProvider implements PublishProvider {
  readonly capabilities: ProviderCapabilities;
  constructor(
    public readonly platform: ProviderPlatform,
    capabilities: Partial<ProviderCapabilities> = {},
  ) {
    this.capabilities = {
      publish: false,
      draft: false,
      mediaUpload: false,
      schedule: false,
      metrics: false,
      manualInstruction: false,
      ...capabilities,
    };
  }

  abstract publish(request: PublishRequest): Promise<PublishResponse>;

  protected normalizeString(value: unknown) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
  }

  protected getEnv(name: string) {
    const envContainer = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return envContainer?.env?.[name];
  }

  protected buildCliFailureManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "CLI 执行失败",
      steps: [
        message,
        "请先手动确认 CLI 命令可独立运行并返回标准 JSON 结果。",
        "建议保留网关模式作为主链路并通过 CLI 作为降级路径。",
      ],
      checkList: ["CLI 命令可执行", "执行环境变量/登录态可用", "命令在时限内返回 JSON"],
      notes: ["建议对 CLI 做幂等性保护与退出码监控。"],
    };
  }

  protected buildCliTimeoutManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "CLI 执行超时",
      steps: [
        message,
        "建议确认命令无交互等待（如扫码/验证码弹窗）。",
        "建议拉长超时或切换网关模式兜底。",
      ],
      checkList: ["CLI 可在时限内返回", "命令无人工交互阻塞", "平台依赖可稳定访问"],
      notes: ["超时优先返回 failed，便于上层做重试。"],
    };
  }

  protected buildCliInvalidJsonManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "CLI 输出不可解析",
      steps: [message, "请确认 CLI 输出为标准 JSON（至少包含 id 或 url）。", "建议切换网关模式作为回退路径。"],
      checkList: ["CLI 输出 JSON", "返回字段包含可识别结果", "调用参数编码正确"],
      notes: ["建议在 CLI 层统一输出 schema 并记录原始日志。"],
    };
  }

  protected buildCliMissingResultManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "CLI 结果缺失",
      steps: [message, "请确认返回体包含 id 或 url。", "如长期缺失，建议优先走网关模式。"],
      checkList: ["返回结果字段可识别", "发布动作实际执行成功", "CLI 与项目字段映射一致"],
      notes: ["可在 CLI 返回中增加发布状态码与原因码。"],
    };
  }
}

export class TwitterProvider extends BaseProvider {
  private static readonly postEndpoint = "https://api.x.com/2/tweets";

  private getOAuth1AppCredentials() {
    return {
      appKey: this.getEnv("X_API_KEY") ?? this.getEnv("TWITTER_API_KEY") ?? this.getEnv("X_CLIENT_KEY") ?? null,
      appSecret: this.getEnv("X_API_SECRET") ?? this.getEnv("TWITTER_API_SECRET") ?? this.getEnv("X_CLIENT_SECRET") ?? null,
    };
  }

  constructor() {
    super("x_twitter", {
      publish: true,
      schedule: true,
      mediaUpload: true,
      metrics: true,
    });
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const { appKey, appSecret } = this.getOAuth1AppCredentials();
    if (!appKey || !appSecret) {
      return {
        status: "manual_required",
        manualInstruction: this.buildTwitterManualInstruction("请先在服务端补充 X_API_KEY / X_API_SECRET。"),
      };
    }

    const credentials = this.resolveCredentials(request.platformAccount);
    if (!credentials) {
      return {
        status: "manual_required",
        manualInstruction: this.buildTwitterManualInstruction("请先补充该账号 OAuth1 凭据（accessToken + accessTokenSecret）。"),
      };
    }

    const text = this.composeTweetText(request.contentVersion);
    const authHeader = this.signOAuth1(
      "POST",
      TwitterProvider.postEndpoint,
      appKey,
      appSecret,
      credentials.accessToken,
      credentials.accessTokenSecret,
    );

    let responseBody = "";
    let payload: unknown = null;
    try {
      const response = await fetch(TwitterProvider.postEndpoint, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ text }),
      });
      responseBody = await response.text();
      if (responseBody) {
        payload = JSON.parse(responseBody);
      }
      if (!response.ok) {
        return this.handleTwitterApiError(response.status, payload, responseBody);
      }
    } catch (error) {
      return {
        status: "failed",
        errorMessage: `请求 X API 失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const responseData = payload as {
      data?: {
        id?: string;
      };
      errors?: Array<{ message?: string; detail?: string; title?: string }>;
    };
    const tweetId = responseData?.data?.id;
    if (!tweetId) {
      return {
        status: "failed",
        errorMessage: `发布成功响应异常：${responseBody || "响应缺少 tweet id"}`,
      };
    }

    const username = request.platformAccount.username?.trim();
    const externalUrl = username
      ? `https://x.com/${encodeURIComponent(username)}/status/${tweetId}`
      : `https://x.com/i/web/status/${tweetId}`;

    return {
      status: "published",
      providerPostId: tweetId,
      externalUrl,
    };
  }

  private composeTweetText(version: ContentVersionProfile) {
    const title = version.title?.trim();
    const body = version.body?.trim();
    if (title && body) {
      return `${title}\n\n${body}`.slice(0, 280);
    }
    if (title) {
      return title.slice(0, 280);
    }
    return body ? body.slice(0, 280) : "（空内容）";
  }

  private resolveCredentials(profile: PublishProfile): { accessToken: string; accessTokenSecret: string } | null {
    const direct = [
      this.tryFromPair(profile.accessToken, profile.accessTokenSecret),
      this.tryFromSingle(profile.accessToken),
      this.tryFromSingle(profile.token),
      this.tryFromPair(profile.tokenEncrypted, profile.refreshTokenEncrypted),
    ];
    for (const candidate of direct) {
      if (candidate) {
        return candidate;
      }
    }

    if (typeof profile.settings === "object" && profile.settings !== null) {
      const settings = profile.settings as Record<string, unknown>;
      const candidates = [settings, settings.credentials, settings.oauth, settings.twitter];
      for (const candidate of candidates) {
        if (typeof candidate !== "object" || candidate === null) {
          continue;
        }
        const source = candidate as Record<string, unknown>;
        const fromDirectPair = this.tryFromPair(
          this.toString(source.accessToken),
          this.toString(source.accessTokenSecret),
        );
        if (fromDirectPair) {
          return fromDirectPair;
        }
        const fromSnakePair = this.tryFromPair(
          this.toString(source.access_token),
          this.toString(source.access_token_secret),
        );
        if (fromSnakePair) {
          return fromSnakePair;
        }
        const fromOauthPair = this.tryFromPair(
          this.toString(source.oauth_token),
          this.toString(source.oauth_token_secret),
        );
        if (fromOauthPair) {
          return fromOauthPair;
        }
        const fromOauthPairAlias = this.tryFromPair(
          this.toString(source.oauthToken),
          this.toString(source.oauthTokenSecret),
        );
        if (fromOauthPairAlias) {
          return fromOauthPairAlias;
        }
        const fromSingle = this.tryFromSingle(this.toString(source.token));
        if (fromSingle) {
          return fromSingle;
        }
      }
    }

    return null;
  }

  private tryFromPair(accessToken: string | null | undefined, accessTokenSecret: string | null | undefined) {
    const token = this.toString(accessToken);
    const secret = this.toString(accessTokenSecret);
    if (!token || !secret) {
      return null;
    }
    return { accessToken: token, accessTokenSecret: secret };
  }

  private tryFromSingle(tokenWithSecret: string | null | undefined) {
    const token = this.toString(tokenWithSecret);
    if (!token) {
      return null;
    }
    const [accessToken, ...secretSegments] = token.split(":");
    const accessTokenSecret = secretSegments.join(":");
    if (!accessToken || !accessTokenSecret) {
      return null;
    }
    return { accessToken, accessTokenSecret };
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private buildTwitterManualInstruction(errorMessage: string): PublishManualInstruction {
    return {
      title: "X 自动发布未就绪",
      steps: [
        errorMessage,
        "请补充平台账号凭据，建议使用 accessToken + accessTokenSecret 或 token:accessTokenSecret 格式。",
        "确认凭据来源于 OAuth1 认证流程（非浏览器 Cookie）。",
        "确认当前环境变量已设置 X_API_KEY、X_API_SECRET。",
      ],
      checkList: [
        "凭据包含 token 与 tokenSecret 两段且非空",
        "数据库内 platformAccount.settings 中至少一处字段可被识别",
      ],
      notes: ["当前不支持模拟浏览器登录，仅支持官方 API 接口发布。"],
    };
  }

  private handleTwitterApiError(status: number, payload: unknown, rawBody: string): PublishResponse {
    const response = payload as {
      errors?: Array<{ message?: string; detail?: string; title?: string }>;
      detail?: string;
      title?: string;
      message?: string;
      error?: string;
    };
    const apiMessage =
      response?.errors
        ?.map((item) => [item.message, item.detail, item.title].filter(Boolean).join(" - "))
        .filter(Boolean)
        .join("；") ||
      response?.error ||
      response?.message ||
      response?.title ||
      response?.detail ||
      rawBody ||
      "X API 返回错误";

    if (status === 401 || status === 403) {
      return {
        status: "manual_required",
        manualInstruction: this.buildTwitterManualInstruction(`授权异常（HTTP ${status}）：${apiMessage}`),
      };
    }
    if (status === 429) {
      return {
        status: "failed",
        errorMessage: `X API 触发限流（HTTP ${status}）：${apiMessage}`,
      };
    }
    return {
      status: "failed",
      errorMessage: `发布失败（HTTP ${status}）：${apiMessage}`,
    };
  }

  private signOAuth1(
    method: string,
    url: string,
    appKey: string,
    appSecret: string,
    accessToken: string,
    accessTokenSecret: string,
  ): string {
    const pct = (value: string) =>
      encodeURIComponent(value)
        .replace(/!/g, "%21")
        .replace(/\*/g, "%2A")
        .replace(/'/g, "%27")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");

    const params: Record<string, string> = {
      oauth_consumer_key: appKey,
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: accessToken,
      oauth_version: "1.0",
    };

    const paramString = Object.keys(params)
      .sort()
      .map((key) => `${pct(key)}=${pct(params[key])}`)
      .join("&");

    const baseString = `${method.toUpperCase()}&${pct(url.split("?")[0])}&${pct(paramString)}`;
    const signingKey = `${pct(appSecret)}&${pct(accessTokenSecret)}`;
    params.oauth_signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

    return `OAuth ${Object.keys(params)
      .sort()
      .map((key) => `${pct(key)}="${pct(params[key])}"`)
      .join(", ")}`;
  }
}

export class XiaohongshuManualProvider extends BaseProvider {
  constructor() {
    super("xiaohongshu", {
      manualInstruction: true,
    });
  }

  async publish(): Promise<PublishResponse> {
    return {
      status: "manual_required",
      manualInstruction: {
        title: "小红书需人工发布（MVP）",
        steps: [
          "打开小红书创作页，创建新笔记。",
          "复制系统生成的标题/正文/标签到对应区域。",
          "上传对应素材后发布为草稿或公开发布。",
          "回填发布链接到系统。",
        ],
        checkList: [
          "标题长度控制在 8~30 字",
          "正文突出产品价值点，避免夸大表述",
          "按平台规则补充至少 1 个话题标签",
        ],
        notes: ["当前阶段仅提供人工辅助，不做官方自动发布。"],
      },
    };
  }
}

type XiaohongshuPublishMode = "bridge" | "cli";

type XiaohongshuPublishTarget = {
  id?: string;
  url?: string;
};

type ZhihuPublishMode = "bridge" | "cli";

type ZhihuPublishConfig = {
  mode: ZhihuPublishMode;
  gatewayUrl?: string;
  cliCommand?: string;
  cliTimeoutMs?: number;
  cliCookieString?: string;
  cliProfilePath?: string;
  createArticlePath?: string;
  createAnswerPath?: string;
};

type ZhihuPublishPayload = {
  action: "create_article" | "create_answer";
  title?: string;
  body: string;
  images: string[];
  questionId?: string;
  tags?: string[];
  anonymous?: boolean;
  payload: Record<string, unknown>;
};

type ZhihuPublishTarget = {
  id?: string;
  url?: string;
};

type WechatPublishMode = "direct" | "bridge" | "cli";

type WechatPublishConfig = {
  mode: WechatPublishMode;
  apiBaseUrl?: string;
  appId?: string;
  appSecret?: string;
  accessToken?: string;
  gatewayUrl?: string;
  cliCommand?: string;
  cliTimeoutMs?: number;
  cliCookieString?: string;
  cliProfilePath?: string;
  draftCreatePath?: string;
  publishPath?: string;
};

type WechatPublishTarget = {
  id?: string;
  url?: string;
};

class XiaohongshuApiProvider extends BaseProvider {
  private static readonly DEFAULT_BRIDGE_PATH = "/api/xiaohongshu/publish";
  private static readonly DEFAULT_CLI_COMMAND = "redbook";

  constructor() {
    super("xiaohongshu", {
      publish: true,
      mediaUpload: true,
      manualInstruction: true,
    });
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const accessType = this.normalizeString(request.platformAccount.accessType);
    const hasToken = Boolean(this.resolveToken(request.platformAccount));
    if (!hasToken && accessType === "manual") {
      return {
        status: "manual_required",
        manualInstruction: this.buildXiaohongshuManualInstruction("该账号标记为手工模式且未提供可执行凭据。"),
      };
    }

    const config = this.resolvePublishConfig(request.platformAccount, accessType);
    if (!config) {
      return {
        status: "manual_required",
        manualInstruction: this.buildXiaohongshuManualInstruction("小红书未配置可执行发布入口（publish gateway 或 CLI）。"),
      };
    }

    const title = request.contentVersion.title?.trim() ?? "无标题";
    const body = request.contentVersion.body?.trim() ?? "";
    const tags = [...this.normalizeTags(request.contentVersion.tags), ...this.normalizeTags(request.contentVersion.topics)];
    const uniqueTags = [...new Set(tags.filter(Boolean))];
    const images = this.extractMediaPaths(request.contentVersion.media);

    const publishPayload = {
      platform: request.platformAccount.platform,
      accountId: request.platformAccount.id,
      title,
      body,
      tags: uniqueTags,
      images,
      settings: request.platformAccount.settings,
    };

    if (config.mode === "bridge") {
      const token = this.resolveToken(request.platformAccount);
      return this.publishViaBridge(config, publishPayload, token);
    }
    return this.publishViaCli(config, publishPayload);
  }

  private resolvePublishConfig(profile: PublishProfile, accessType?: string) {
    const settings = this.toRecord(profile.settings);
    const nested = this.toRecord(settings.xiaohongshu);
    const explicitMode = this.normalizeString(
      settings.publishMode ?? settings.mode ?? nested.publishMode ?? nested.mode ?? nested.type,
    );
    const envMode = this.normalizeString(this.getEnv("XIAOHONGSHU_PUBLISH_MODE"));
    const finalMode = this.normalizePublishMode(explicitMode || envMode);

    const gatewayUrl = this.normalizeString(
      settings.publishGatewayUrl ??
        settings.gatewayUrl ??
        nested.publishGatewayUrl ??
        nested.gatewayUrl ??
        this.getEnv("XIAOHONGSHU_PUBLISH_GATEWAY_URL"),
    );
    const cliCommand = this.normalizeString(
      settings.cliCommand ??
        settings.redbookCommand ??
        nested.cliCommand ??
        nested.redbookCommand ??
        this.getEnv("XIAOHONGSHU_CLI_COMMAND") ??
        XiaohongshuApiProvider.DEFAULT_CLI_COMMAND,
    );
    const cliTimeoutMs = this.toPositiveInt(
      settings.cliTimeoutMs ??
        settings.timeoutMs ??
        nested.cliTimeoutMs ??
        nested.timeoutMs ??
        this.getEnv("XIAOHONGSHU_CLI_TIMEOUT_MS") ??
        undefined,
    );

    let resolvedMode: XiaohongshuPublishMode | undefined = finalMode;
    if (!resolvedMode && accessType) {
      if (accessType === "browser_assist") {
        resolvedMode = "cli";
      } else if (accessType === "official_api" || accessType === "draft_api") {
        resolvedMode = "bridge";
      }
    }
    if (!resolvedMode) {
      resolvedMode = gatewayUrl ? "bridge" : cliCommand ? "cli" : undefined;
    }

    if (!resolvedMode) {
      return null;
    }

    if (resolvedMode === "bridge" && !gatewayUrl) {
      return null;
    }

    return {
      mode: resolvedMode,
      gatewayUrl,
      cliCommand,
      cliTimeoutMs,
      cliCookieString: this.normalizeString(settings.cookieString ?? settings.cookies ?? nested.cookieString ?? nested.cookies),
      cliChromeProfile: this.normalizeString(settings.chromeProfile ?? nested.chromeProfile),
    };
  }

  private normalizePublishMode(value: string | undefined): XiaohongshuPublishMode | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.toLowerCase().trim();
    if (normalized === "bridge" || normalized === "cli") {
      return normalized;
    }
    return undefined;
  }

  private buildXiaohongshuManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "小红书自动发布未就绪",
      steps: [
        message,
        "配置方式 A（推荐）：HTTP 网关模式，设置 account.settings.publishGatewayUrl 或 XIAOHONGSHU_PUBLISH_GATEWAY_URL，POST /api/xiaohongshu/publish。",
        "配置方式 B：CLI 模式，设置 account.settings.cliCommand（默认 redbook）并准备可复用登录态。",
        "如是 CLI 模式，建议先通过命令行手动确认 `redbook post` 可发帖后再接入。",
      ],
      checkList: [
        "account.settings 中已保留发布方式（publishMode/cliCommand/cliTimeoutMs/cliCookieString）",
        "account.tokenEncrypted 或 cookie 可被网关/CLI 识别",
        "版本素材 media 可被发布端读取（至少文本存在）",
      ],
      notes: ["当前实现走工具/网关链路，不内置浏览器模拟。"],
    };
  }

  private async publishViaBridge(
    config: { mode: XiaohongshuPublishMode; gatewayUrl?: string; cliCommand?: string; cliTimeoutMs?: number; cliCookieString?: string; cliChromeProfile?: string },
    payload: {
      platform: string;
      accountId: string;
      title: string;
      body: string;
      tags: string[];
      images: string[];
      settings: unknown;
    },
    token: string | null,
  ): Promise<PublishResponse> {
    const url = this.toFullGatewayUrl(config.gatewayUrl ?? "", XiaohongshuApiProvider.DEFAULT_BRIDGE_PATH);
    if (!url) {
      return {
        status: "manual_required",
        manualInstruction: this.buildXiaohongshuManualInstruction("发布网关地址未配置。"),
      };
    }

    const requestBody = {
      platform: payload.platform,
      accountId: payload.accountId,
      title: payload.title,
      body: payload.body,
      tags: payload.tags,
      images: payload.images,
      settings: payload.settings,
      source: "marketing-platform",
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const timeoutMs = config.cliTimeoutMs ?? 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const responseText = await response.text();
      const parsedResponse = this.parseJson(responseText);

      if (!response.ok) {
        return this.handleBridgeApiError(response.status, parsedResponse, responseText);
      }
      if (!parsedResponse) {
        return {
          status: "failed",
          errorMessage: `发布网关返回非 JSON 响应：${responseText.slice(0, 300)}`,
        };
      }

      const outcome = this.extractPublishResult(parsedResponse);
      if (outcome.id || outcome.url) {
        return {
          status: "published",
          providerPostId: outcome.id,
          externalUrl: outcome.url,
        };
      }
      return {
        status: "failed",
        errorMessage: `发布网关返回成功，但未识别到 note id/url：${responseText.slice(0, 300)}`,
      };
    } catch (error) {
      clearTimeout(timeout);
      return {
        status: "failed",
        errorMessage: `发布网关请求失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private handleBridgeApiError(status: number, payload: unknown, rawText: string): PublishResponse {
    const source = this.toRecord(payload);
    const message =
      this.normalizeString(source.errorMessage) ||
      this.normalizeString(source.message) ||
      this.normalizeString(source.error) ||
      this.normalizeString(source.reason) ||
      rawText ||
      "发布网关返回错误";

    if (status === 401 || status === 403) {
      return {
        status: "manual_required",
        manualInstruction: this.buildXiaohongshuManualInstruction(`网关鉴权异常（HTTP ${status}）：${message}`),
      };
    }
    if (status === 429) {
      return {
        status: "failed",
        errorMessage: `发布网关触发限流（HTTP ${status}）：${message}`,
      };
    }
    return {
      status: "failed",
      errorMessage: `发布网关返回失败（HTTP ${status}）：${message}`,
    };
  }

  private async publishViaCli(
    config: { mode: XiaohongshuPublishMode; cliCommand?: string; cliTimeoutMs?: number; cliCookieString?: string; cliChromeProfile?: string },
    payload: {
      platform: string;
      accountId: string;
      title: string;
      body: string;
      tags: string[];
      images: string[];
      settings: unknown;
    },
  ): Promise<PublishResponse> {
    if (!config.cliCommand) {
      return {
        status: "manual_required",
        manualInstruction: this.buildXiaohongshuManualInstruction("CLI 命令未配置。"),
      };
    }

    const title = `${payload.platform}｜${payload.title}`.slice(0, 120);
    const body = payload.body ? `${payload.body}\n\n${this.formatHashtags(payload.tags)}`.trim() : "";
    const args = ["post", "--json", "--title", title, "--body", body];
    if (payload.images.length > 0) {
      args.push("--images", payload.images.join(","));
    }
    if (config.cliCookieString) {
      args.push("--cookie-string", config.cliCookieString);
    }
    if (config.cliChromeProfile) {
      args.push("--chrome-profile", config.cliChromeProfile);
    }

    const commandResult = await this.runCommand(config.cliCommand, args, config.cliTimeoutMs ?? 30000);
    if (commandResult.timedOut) {
      return {
        status: "failed",
        errorMessage: `CLI 调用超时（${config.cliTimeoutMs ?? 30000}ms）：${config.cliCommand}`,
      };
    }
    if (!commandResult.ok) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliFailureManualInstruction(
          `${config.cliCommand} 执行失败（退出码: ${commandResult.code === null ? "未返回退出码" : String(commandResult.code)}）：${commandResult.stderr
            .slice(0, 300) || "未返回 stderr"}，请先确保 redbook 登录态可用。`,
        ),
      };
    }

    const parsed =
      this.extractLastJson(commandResult.stdout) ||
      this.extractLastJson(commandResult.stderr);
    if (!parsed) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliInvalidJsonManualInstruction("CLI 未返回可解析 JSON，建议改为 HTTP 网关模式。"),
      };
    }

    const outcome = this.extractPublishResult(parsed);
    if (!outcome.id && !outcome.url) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliMissingResultManualInstruction(
          `CLI 返回未包含发布结果：${(commandResult.stdout || commandResult.stderr).slice(0, 300)}`,
        ),
      };
    }

    return {
      status: "published",
      providerPostId: outcome.id,
      externalUrl: outcome.url,
    };
  }

  private extractPublishResult(payload: unknown): XiaohongshuPublishTarget {
    const values = [this.toRecord(payload), this.toRecord(this.toRecord(payload).data), this.toRecord(this.toRecord(payload).result)];
    for (const value of values) {
      const id = this.normalizeString(value.id || value.noteId || value.note_id || value.postId || value.note_id);
      const url = this.normalizeString(value.url || value.noteUrl || value.note_url || value.shareUrl || this.normalizeString(this.toRecord(value.data).url));
      if (id || url) {
        return { id, url };
      }
    }
    return {};
  }

  private extractMediaPaths(media: unknown) {
    if (!Array.isArray(media)) {
      return [];
    }
    const candidates: string[] = [];
    for (const item of media) {
      const node = this.toRecord(item);
      const mediaAsset = this.toRecord(node.mediaAsset);
      const path = this.normalizeString(mediaAsset.path || node.path || node.url || mediaAsset.url);
      if (path) {
        candidates.push(path);
      }
    }
    return [...new Set(candidates)];
  }

  private normalizeTags(tags: unknown) {
    if (typeof tags === "string") {
      return tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (Array.isArray(tags)) {
      return tags.map((item) => this.normalizeString(item)).filter(Boolean) as string[];
    }
    return [];
  }

  private formatHashtags(tags: string[]) {
    if (!tags.length) {
      return "";
    }
    return tags.map((tag) => `#${tag}`).join(" ");
  }

  private async runCommand(command: string, args: string[], timeoutMs: number) {
    return new Promise<{
      ok: boolean;
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: { toString: () => string }) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: { toString: () => string }) => {
        stderr += chunk.toString();
      });
      child.on("error", (error: { code?: string }) => {
        clearTimeout(timeout);
        if (error.code === "ENOENT") {
          resolve({
            ok: false,
            code: -1,
            stdout,
            stderr: `命令不存在：${command}`,
            timedOut: false,
          });
          return;
        }
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeout);
        resolve({
          ok: !timedOut && code === 0,
          code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  private resolveToken(profile: PublishProfile): string | null {
    const settings = this.toRecord(profile.settings);
    const fromProfile =
      this.normalizeString(profile.accessToken) ||
      this.normalizeString(profile.tokenEncrypted) ||
      this.normalizeString(profile.refreshTokenEncrypted) ||
      this.normalizeString(profile.token);
    const fromSettings =
      this.normalizeString(settings.token) ||
      this.normalizeString(settings.apiToken) ||
      this.normalizeString(settings.accessToken) ||
      this.normalizeString(settings.access_token) ||
      this.normalizeString(settings.cookie) ||
      this.normalizeString(settings.cookieString);
    return fromProfile || fromSettings || null;
  }

  private toFullGatewayUrl(base: string, fallbackPath: string) {
    const url = base.trim().replace(/\/$/, "");
    if (!url) {
      return "";
    }
    if (url.includes("://")) {
      return `${url}${url.endsWith("/") ? "" : "/"}${url.endsWith(fallbackPath) ? "" : fallbackPath.replace(/^\//, "")}`;
    }
    return `${url}${url.endsWith("/") ? "" : "/"}${fallbackPath.replace(/^\//, "")}`;
  }

  private extractLastJson(text: string) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      const json = this.parseJson(line);
      if (json) {
        return json;
      }
    }
    return null;
  }

  private parseJson(text: string): unknown | null {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private toRecord(value: unknown) {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }

  private toPositiveInt(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = Math.floor(value);
      return parsed > 1000 ? parsed : undefined;
    }
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 1000) {
      return undefined;
    }
    return Math.floor(parsed);
  }
}

class ZhihuApiProvider extends BaseProvider {
  private static readonly DEFAULT_GATEWAY_HOST = "http://127.0.0.1:8005";
  private static readonly DEFAULT_CREATE_ARTICLE_PATH = "/zhihu-mcp-server/create_article";
  private static readonly DEFAULT_CREATE_ANSWER_PATH = "/zhihu-mcp-server/create_answer";
  private static readonly DEFAULT_CLI_COMMAND = "zhihu-mcp-server";
  private static readonly DEFAULT_CLI_TIMEOUT_MS = 30000;

  constructor() {
    super("zhihu", {
      publish: true,
      draft: true,
      mediaUpload: true,
      manualInstruction: true,
    });
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const accessType = this.normalizeString(request.platformAccount.accessType);
    const hasCredibleAuth = this.hasPublishAuth(request.platformAccount);
    const config = this.resolvePublishConfig(request.platformAccount, accessType);
    if (!config) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction(
          accessType === "manual"
            ? "该账号标记为 manual 模式，且未配置可用的发布链路。"
            : "未检测到知乎发布链路（网关/CLI）配置。",
        ),
      };
    }

    const payload = this.buildPublishPayload(request.contentVersion, request.platformAccount);
    if (!payload) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction("该内容形态当前未配置自动发布映射（仅支持 article 与 answer）。"),
      };
    }

    if (accessType === "manual" && !hasCredibleAuth) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction("账号为 manual 模式且未提供可执行凭据。"),
      };
    }

    const headers = this.buildAuthHeaders(request.platformAccount);
    if (config.mode === "bridge") {
      return this.publishViaBridge(config, payload, headers);
    }
    return this.publishViaCli(config, payload);
  }

  private toRecord(value: unknown) {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private toPositiveInt(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = Math.floor(value);
      return parsed > 1000 ? parsed : undefined;
    }

    const normalized = this.normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 1000) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  private hasPublishAuth(profile: PublishProfile) {
    const settings = this.toRecord(profile.settings);
    return Boolean(
      this.normalizeString(profile.accessToken) ||
        this.normalizeString(profile.tokenEncrypted) ||
        this.normalizeString(profile.refreshTokenEncrypted) ||
        this.normalizeString(profile.token) ||
        this.normalizeString(settings.token) ||
        this.normalizeString(settings.apiToken) ||
        this.normalizeString(settings.accessToken) ||
        this.normalizeString(settings.access_token) ||
        this.normalizeString(settings.cookie) ||
        this.normalizeString(settings.cookieString),
    );
  }

  private resolvePublishConfig(profile: PublishProfile, accessType?: string): ZhihuPublishConfig | null {
    const settings = this.toRecord(profile.settings);
    const nested = this.toRecord(settings.zhihu);
    const explicitMode = this.normalizeString(
      settings.publishMode ?? settings.mode ?? nested.publishMode ?? nested.mode ?? nested.type ?? nested.publish_mode,
    );
    const envMode = this.normalizeString(this.getEnv("ZHIHU_PUBLISH_MODE"));
    const finalMode = this.normalizePublishMode(explicitMode || envMode);

    const gatewayUrl = this.normalizeString(
      settings.publishGatewayUrl ??
        settings.gatewayUrl ??
        nested.publishGatewayUrl ??
        nested.gatewayUrl ??
        this.getEnv("ZHIHU_PUBLISH_GATEWAY_URL"),
    );
    const cliCommand = this.normalizeString(
      settings.cliCommand ??
        nested.cliCommand ??
        nested.command ??
        this.getEnv("ZHIHU_CLI_COMMAND") ??
        this.getEnv("ZHIHU_CLI_CMD") ??
        ZhihuApiProvider.DEFAULT_CLI_COMMAND,
    );
    const cliTimeoutMs = this.toPositiveInt(
      settings.cliTimeoutMs ??
        settings.cliTimeout ??
        nested.cliTimeoutMs ??
        nested.cliTimeout ??
        this.getEnv("ZHIHU_CLI_TIMEOUT_MS") ??
        ZhihuApiProvider.DEFAULT_CLI_TIMEOUT_MS,
    );
    const cliCookieString = this.normalizeString(
      settings.cookieString ?? nested.cookieString ?? settings.cookies ?? nested.cookies ?? settings.cookie ?? nested.cookie,
    );
    const cliProfilePath = this.normalizeString(settings.cliProfilePath ?? settings.chromeProfile ?? nested.cliProfilePath ?? nested.chromeProfile);
    const createArticlePath = this.normalizeString(
      settings.createArticlePath ??
        nested.createArticlePath ??
        this.getEnv("ZHIHU_CREATE_ARTICLE_PATH") ??
        ZhihuApiProvider.DEFAULT_CREATE_ARTICLE_PATH,
    );
    const createAnswerPath = this.normalizeString(
      settings.createAnswerPath ??
        nested.createAnswerPath ??
        this.getEnv("ZHIHU_CREATE_ANSWER_PATH") ??
        ZhihuApiProvider.DEFAULT_CREATE_ANSWER_PATH,
    );

    let resolvedMode: ZhihuPublishMode | undefined = finalMode;
    if (!resolvedMode && accessType) {
      if (accessType === "browser_assist") {
        resolvedMode = "cli";
      } else if (accessType === "official_api" || accessType === "draft_api") {
        resolvedMode = gatewayUrl ? "bridge" : "cli";
      }
    }
    if (!resolvedMode) {
      if (gatewayUrl) {
        resolvedMode = "bridge";
      } else if (cliCommand) {
        resolvedMode = "cli";
      }
    }
    if (!resolvedMode) {
      return null;
    }
    if (resolvedMode === "bridge" && !gatewayUrl) {
      return {
        mode: "bridge",
        gatewayUrl: ZhihuApiProvider.DEFAULT_GATEWAY_HOST,
        cliTimeoutMs,
        createArticlePath,
        createAnswerPath,
      };
    }
    if (resolvedMode === "cli" && !cliCommand) {
      return null;
    }

    return {
      mode: resolvedMode,
      gatewayUrl,
      cliCommand,
      cliTimeoutMs,
      cliCookieString,
      cliProfilePath,
      createArticlePath,
      createAnswerPath,
    };
  }

  private normalizePublishMode(value: string | undefined): ZhihuPublishMode | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.toLowerCase().trim();
    if (normalized === "bridge" || normalized === "cli") {
      return normalized;
    }
    return undefined;
  }

  private buildPublishPayload(version: ContentVersionProfile, profile: PublishProfile): ZhihuPublishPayload | null {
    const title = this.normalizeString(version.title) ?? "无标题";
    const body = this.normalizeString(version.body) ?? "";
    const images = this.extractMediaPaths(version.media);
    const tags = [...this.normalizeTags(version.tags), ...this.normalizeTags(version.topics)];
    const questionId = this.extractQuestionId(version, profile);

    if (version.contentType === "answer") {
      if (!questionId) {
        return null;
      }
      return {
        action: "create_answer",
        body,
        images,
        questionId,
        anonymous: this.extractAnonymousFlag(version),
        payload: {
          question_id: questionId,
          content: body,
          images,
          is_anonymous: this.extractAnonymousFlag(version),
          tags,
        },
      };
    }

    if (version.contentType === "article") {
      return {
        action: "create_article",
        title,
        body,
        images,
        tags,
        payload: {
          title,
          content: body,
          images,
          tags,
        },
      };
    }

    return null;
  }

  private extractQuestionId(version: ContentVersionProfile, profile: PublishProfile): string | null {
    const candidateContainers = [
      this.toRecord(profile.settings),
      this.toRecord(profile.settings).zhihu && this.toRecord(this.toRecord(profile.settings).zhihu),
      this.toRecord(version.settings),
    ].filter(Boolean) as Record<string, unknown>[];

    const keys = [
      "questionId",
      "question_id",
      "question",
      "questionIdOrUrl",
      "question_id_or_url",
      "zhihuQuestionId",
      "zhihu_question_id",
    ];
    for (const container of candidateContainers) {
      for (const key of keys) {
        const parsed = this.parseQuestionId(this.toString(container[key]));
        if (parsed) {
          return parsed;
        }
      }
      const rawUrl = this.toString(container.url);
      const parsedUrl = this.parseQuestionId(rawUrl);
      if (parsedUrl) {
        return parsedUrl;
      }
    }
    return null;
  }

  private parseQuestionId(value: string | null | undefined) {
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return null;
    }
    if (/^\d+$/.test(normalized)) {
      return normalized;
    }
    const urlMatch = normalized.match(/question\/(\d+)|qid=(\d+)|id=(\d+)/i);
    if (urlMatch?.[1]) {
      return urlMatch[1];
    }
    if (urlMatch?.[2]) {
      return urlMatch[2];
    }
    if (urlMatch?.[3]) {
      return urlMatch[3];
    }
    return null;
  }

  private extractAnonymousFlag(version: ContentVersionProfile) {
    const settings = this.toRecord(version.settings);
    const explicit = this.normalizeString(settings.isAnonymous ?? settings.is_anonymous ?? settings.anonymous ?? settings.anonymousPublish);
    return explicit === "true";
  }

  private buildAuthHeaders(profile: PublishProfile) {
    const settings = this.toRecord(profile.settings);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };

    const token =
      this.normalizeString(profile.accessToken) ??
      this.normalizeString(profile.tokenEncrypted) ??
      this.normalizeString(profile.refreshTokenEncrypted) ??
      this.normalizeString(profile.token) ??
      this.normalizeString(settings.token) ??
      this.normalizeString(settings.accessToken) ??
      this.normalizeString(settings.apiToken);
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const cookie = this.normalizeString(
      settings.cookie ??
        settings.cookieString ??
        settings.cookies ??
        this.toRecord(settings.auth).cookie ??
        settings.sessionCookie ??
        settings.session,
    );
    if (cookie) {
      headers.cookie = cookie;
    }

    return headers;
  }

  private async publishViaBridge(
    config: ZhihuPublishConfig,
    payload: ZhihuPublishPayload,
    headers: Record<string, string>,
  ): Promise<PublishResponse> {
    const path = payload.action === "create_answer" ? config.createAnswerPath : config.createArticlePath;
    const endpoint = this.toFullGatewayUrl(config.gatewayUrl ?? ZhihuApiProvider.DEFAULT_GATEWAY_HOST, path ?? ZhihuApiProvider.DEFAULT_CREATE_ARTICLE_PATH);
    if (!endpoint) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction("知乎网关地址未配置。"),
      };
    }

    const timeoutMs = config.cliTimeoutMs ?? ZhihuApiProvider.DEFAULT_CLI_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload.payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const responseText = await response.text();
      const parsedResponse = this.parseJson(responseText);
      if (!response.ok) {
        return this.handleZhihuError(response.status, parsedResponse, responseText);
      }
      if (!parsedResponse) {
        return {
          status: "failed",
          errorMessage: `知乎网关返回非 JSON 响应：${responseText.slice(0, 300)}`,
        };
      }

      const outcome = this.extractZhihuPublishResult(parsedResponse);
      if (outcome.id || outcome.url) {
        return {
          status: "published",
          providerPostId: outcome.id,
          externalUrl: outcome.url,
        };
      }
      return {
        status: "failed",
        errorMessage: `知乎网关返回成功，但未识别到发布结果：${responseText.slice(0, 300)}`,
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          status: "failed",
          errorMessage: `知乎网关请求超时（${timeoutMs}ms）：${endpoint}`,
        };
      }
      return {
        status: "failed",
        errorMessage: `知乎网关请求失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async publishViaCli(config: ZhihuPublishConfig, payload: ZhihuPublishPayload): Promise<PublishResponse> {
    if (!config.cliCommand) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction("CLI 命令未配置。"),
      };
    }

    const args = ["publish_markdown", "--content", payload.body];
    if (payload.title) {
      args.push("--title", payload.title);
    }
    if (payload.images.length > 0) {
      args.push("--images", payload.images.join(","));
    }
    if (payload.action === "create_answer" && payload.questionId) {
      args.push("--question-id", payload.questionId);
    }
    if (payload.anonymous) {
      args.push("--anonymous");
    }
    args.push(`--action=${payload.action}`);
    if (config.cliCookieString) {
      args.push("--cookie", config.cliCookieString);
    }
    if (config.cliProfilePath) {
      args.push("--chrome-profile", config.cliProfilePath);
    }

    const commandResult = await this.runCommand(config.cliCommand, args, config.cliTimeoutMs ?? ZhihuApiProvider.DEFAULT_CLI_TIMEOUT_MS);
    if (commandResult.timedOut) {
      return {
        status: "failed",
        errorMessage: `CLI 调用超时（${config.cliTimeoutMs ?? ZhihuApiProvider.DEFAULT_CLI_TIMEOUT_MS}ms）：${config.cliCommand}`,
      };
    }
    if (!commandResult.ok) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliFailureManualInstruction(
          `${config.cliCommand} 执行失败（退出码: ${commandResult.code === null ? "未返回退出码" : String(commandResult.code)}）：${commandResult.stderr
            .slice(0, 300) || "未返回 stderr"}，建议切换网关模式。`,
        ),
      };
    }

    const parsed = this.extractLastJson(commandResult.stdout) || this.extractLastJson(commandResult.stderr);
    if (!parsed) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliInvalidJsonManualInstruction("CLI 未返回可解析 JSON。"),
      };
    }

    const outcome = this.extractZhihuPublishResult(parsed);
    if (!outcome.id && !outcome.url) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliMissingResultManualInstruction(
          `CLI 返回未包含发布结果：${(commandResult.stdout || commandResult.stderr).slice(0, 300)}`,
        ),
      };
    }

    return {
      status: "published",
      providerPostId: outcome.id,
      externalUrl: outcome.url,
    };
  }

  private extractZhihuPublishResult(payload: unknown): ZhihuPublishTarget {
    const values = [this.toRecord(payload), this.toRecord(this.toRecord(payload).data), this.toRecord(this.toRecord(payload).result)];
    for (const value of values) {
      const data = this.toRecord(value.data);
      const id = this.normalizeString(
        value.id ||
          value.articleId ||
          value.article_id ||
          value.answerId ||
          value.answer_id ||
          data.id ||
          data.article_id ||
          data.answer_id,
      );
      const url = this.normalizeString(
        value.url ||
          value.articleUrl ||
          value.article_url ||
          value.answerUrl ||
          value.answer_url ||
          data.url ||
          data.shareUrl ||
          data.share_url,
      );
      if (id || url) {
        return { id, url };
      }
    }
    return {};
  }

  private handleZhihuError(status: number, payload: unknown, rawText: string): PublishResponse {
    const source = this.toRecord(payload);
    const message =
      this.normalizeString(source.errorMessage) ||
      this.normalizeString(source.message) ||
      this.normalizeString(source.error) ||
      this.normalizeString(this.toRecord(source.data).errorMessage) ||
      rawText ||
      "知乎网关返回错误";

    if (status === 401 || status === 403) {
      return {
        status: "manual_required",
        manualInstruction: this.buildZhihuManualInstruction(`授权异常（HTTP ${status}）：${message}`),
      };
    }
    if (status === 429) {
      return {
        status: "failed",
        errorMessage: `知乎网关触发限流（HTTP ${status}）：${message}`,
      };
    }
    return {
      status: "failed",
      errorMessage: `知乎网关返回失败（HTTP ${status}）：${message}`,
    };
  }

  private buildZhihuManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "知乎自动发布未就绪",
      steps: [
        message,
        "优先配置网关模式：`account.settings.publishGatewayUrl`（如：http://127.0.0.1:8005）。",
        "网关必须能映射到 `POST /zhihu-mcp-server/create_article` 或 `/create_answer`。",
        "内容类型为 answer 时，需要 `questionId`（id 或 URL）。",
      ],
      checkList: [
        "已设置 publishMode/网关地址或 CLI 命令",
        "账号会话/token/cookie 可由网关读取或由 CLI 透传",
        "网关返回 JSON（至少 id/url）",
      ],
      notes: ["当前为标准化网关/CLI 方案，不内置浏览器模拟。"],
    };
  }

  private extractMediaPaths(media: unknown) {
    if (!Array.isArray(media)) {
      return [];
    }
    const candidates: string[] = [];
    for (const item of media) {
      const node = this.toRecord(item);
      const mediaAsset = this.toRecord(node.mediaAsset);
      const path = this.normalizeString(mediaAsset.path || node.path || node.url || mediaAsset.url || node.src);
      if (path) {
        candidates.push(path);
      }
    }
    return [...new Set(candidates)];
  }

  private normalizeTags(tags: unknown) {
    if (typeof tags === "string") {
      return tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (Array.isArray(tags)) {
      return tags.map((item) => this.normalizeString(item)).filter(Boolean) as string[];
    }
    return [];
  }

  private runCommand(command: string, args: string[], timeoutMs: number) {
    return new Promise<{
      ok: boolean;
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: { toString: () => string }) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: { toString: () => string }) => {
        stderr += chunk.toString();
      });
      child.on("error", (error: { code?: string }) => {
        clearTimeout(timeout);
        if (error.code === "ENOENT") {
          resolve({
            ok: false,
            code: -1,
            stdout,
            stderr: `命令不存在：${command}`,
            timedOut: false,
          });
          return;
        }
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeout);
        resolve({
          ok: !timedOut && code === 0,
          code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  private parseJson(text: string): unknown | null {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private extractLastJson(text: string) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      const json = this.parseJson(line);
      if (json) {
        return json;
      }
    }
    return null;
  }

  private toFullGatewayUrl(base: string, fallbackPath: string) {
    const url = base.trim().replace(/\/$/, "");
    if (!url) {
      return "";
    }
    if (url.includes("://")) {
      return `${url}${url.endsWith("/") ? "" : "/"}${url.endsWith(fallbackPath) ? "" : fallbackPath.replace(/^\//, "")}`;
    }
    return `${url}${url.endsWith("/") ? "" : "/"}${fallbackPath.replace(/^\//, "")}`;
  }
}

class WechatApiProvider extends BaseProvider {
  private static readonly DEFAULT_API_BASE_URL = "https://api.weixin.qq.com";
  private static readonly DEFAULT_DRAFT_PATH = "/cgi-bin/draft/add";
  private static readonly DEFAULT_PUBLISH_PATH = "/cgi-bin/freepublish/submit";
  private static readonly DEFAULT_TOKEN_PATH = "/cgi-bin/token?grant_type=client_credential";
  private static readonly DEFAULT_GATEWAY_PATH = "/api/wechat/publish";
  private static readonly DEFAULT_CLI_COMMAND = "wechat-official";
  private static readonly DEFAULT_CLI_TIMEOUT_MS = 30000;

  constructor() {
    super("wechat_official_account", {
      publish: true,
      mediaUpload: true,
      manualInstruction: true,
    });
  }

  async publish(request: PublishRequest): Promise<PublishResponse> {
    const accessType = this.normalizeString(request.platformAccount.accessType);
    const config = this.resolvePublishConfig(request.platformAccount, accessType);
    if (!config) {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction(
          accessType === "manual"
            ? "该账号标记为手工模式且未配置可执行发布方式。"
            : "微信公众号未配置可执行发布方式（官方 API / 网关 / CLI）。",
        ),
      };
    }

    if ((accessType === "manual" || !accessType) && !this.resolveToken(request.platformAccount)) {
      if (config.mode !== "bridge") {
        return {
          status: "manual_required",
          manualInstruction: this.buildWechatManualInstruction("账号未提供发布凭据且未配置网关模式。"),
        };
      }
    }

    const contentType = request.contentVersion.contentType;
    if (contentType !== "article" && contentType !== "news") {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction(`当前仅支持 article/news 形态自动发布，当前为 ${contentType}。`),
      };
    }

    const title = this.normalizeString(request.contentVersion.title) ?? "无标题";
    const body = this.normalizeString(request.contentVersion.body) ?? "";
    const payload = {
      title,
      body,
      tags: [...this.normalizeTags(request.contentVersion.tags), ...this.normalizeTags(request.contentVersion.topics)],
      images: this.extractMediaPaths(request.contentVersion.media),
      settings: request.platformAccount.settings,
      contentSettings: request.contentVersion.settings,
    };

    if (config.mode === "direct") {
      return this.publishDirect(config, payload);
    }
    if (config.mode === "bridge") {
      return this.publishViaBridge(config, payload);
    }
    return this.publishViaCli(config, payload);
  }

  private resolvePublishConfig(profile: PublishProfile, accessType?: string): WechatPublishConfig | null {
    const settings = this.toRecord(profile.settings);
    const nested = this.toRecord(settings.wechat);

    const explicitMode = this.normalizeString(
      settings.publishMode ??
        settings.mode ??
        settings.publish_mode ??
        nested.publishMode ??
        nested.publish_mode ??
        nested.type,
    );
    const envMode = this.normalizeString(this.getEnv("WECHAT_PUBLISH_MODE") ?? this.getEnv("WECHAT_OFFICIAL_PUBLISH_MODE"));
    const finalMode = this.normalizePublishMode(explicitMode || envMode);

    const apiBaseUrl = this.normalizeString(
      settings.apiBaseUrl ??
        settings.baseUrl ??
        this.getEnv("WECHAT_API_BASE_URL") ??
        WechatApiProvider.DEFAULT_API_BASE_URL,
    );
    const appId = this.normalizeString(settings.appId ?? settings.app_id ?? nested.appId ?? nested.app_id ?? this.getEnv("WECHAT_APP_ID"));
    const appSecret = this.normalizeString(
      settings.appSecret ??
        settings.app_secret ??
        settings.secret ??
        nested.appSecret ??
        nested.app_secret ??
        nested.secret ??
        this.getEnv("WECHAT_APP_SECRET"),
    );
    const accessToken = this.resolveToken(profile) || undefined;
    const gatewayUrl = this.normalizeString(
      settings.publishGatewayUrl ??
        settings.gatewayUrl ??
        nested.publishGatewayUrl ??
        nested.gatewayUrl ??
        this.getEnv("WECHAT_PUBLISH_GATEWAY_URL"),
    );
    const cliCommand = this.normalizeString(
      settings.cliCommand ??
        settings.command ??
        nested.cliCommand ??
        nested.command ??
        this.getEnv("WECHAT_CLI_COMMAND") ??
        this.getEnv("WECHAT_OFFICIAL_CLI_COMMAND") ??
        WechatApiProvider.DEFAULT_CLI_COMMAND,
    );
    const cliTimeoutMs = this.toPositiveInt(
      settings.cliTimeoutMs ??
        settings.cliTimeout ??
        nested.cliTimeoutMs ??
        nested.cliTimeout ??
        this.getEnv("WECHAT_CLI_TIMEOUT_MS") ??
        WechatApiProvider.DEFAULT_CLI_TIMEOUT_MS,
    );
    const cliCookieString = this.normalizeString(
      settings.cookieString ??
        settings.cookies ??
        nested.cookieString ??
        nested.cookies ??
        this.getEnv("WECHAT_COOKIE_STRING"),
    );
    const cliProfilePath = this.normalizeString(
      settings.cliProfilePath ??
        settings.chromeProfile ??
        nested.cliProfilePath ??
        nested.chromeProfile ??
        this.getEnv("WECHAT_CLI_PROFILE_PATH"),
    );

    const draftCreatePath = this.normalizeString(
      settings.draftCreatePath ??
        nested.draftCreatePath ??
        this.getEnv("WECHAT_DRAFT_CREATE_PATH") ??
        WechatApiProvider.DEFAULT_DRAFT_PATH,
    );
    const publishPath = this.normalizeString(
      settings.publishPath ??
        nested.publishPath ??
        this.getEnv("WECHAT_PUBLISH_PATH") ??
        WechatApiProvider.DEFAULT_PUBLISH_PATH,
    );

    let resolvedMode: WechatPublishMode | undefined = finalMode;
    if (!resolvedMode && accessType) {
      if (accessType === "official_api" || accessType === "draft_api") {
        if (accessType && appId && appSecret) {
          resolvedMode = "direct";
        } else {
          resolvedMode = gatewayUrl ? "bridge" : (cliCommand ? "cli" : undefined);
        }
      } else if (accessType === "browser_assist") {
        resolvedMode = cliCommand ? "cli" : undefined;
      }
    }
    if (!resolvedMode) {
      if (appId && appSecret) {
        resolvedMode = "direct";
      } else if (gatewayUrl) {
        resolvedMode = "bridge";
      } else if (cliCommand) {
        resolvedMode = "cli";
      }
    }
    if (!resolvedMode) {
      return null;
    }
    if (resolvedMode === "direct" && !appId && !appSecret && !accessToken) {
      return null;
    }
    if (resolvedMode === "bridge" && !gatewayUrl) {
      return null;
    }
    if (resolvedMode === "cli" && !cliCommand) {
      return null;
    }

    return {
      mode: resolvedMode,
      apiBaseUrl,
      appId,
      appSecret,
      accessToken,
      gatewayUrl,
      cliCommand,
      cliTimeoutMs,
      cliCookieString,
      cliProfilePath,
      draftCreatePath,
      publishPath,
    };
  }

  private normalizePublishMode(value: string | undefined): WechatPublishMode | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.toLowerCase().trim();
    if (normalized === "direct" || normalized === "bridge" || normalized === "cli") {
      return normalized;
    }
    return undefined;
  }

  private resolveToken(profile: PublishProfile): string | null {
    const settings = this.toRecord(profile.settings);
    return (
      this.normalizeString(profile.accessToken) ||
      this.normalizeString(profile.token) ||
      this.normalizeString(profile.tokenEncrypted) ||
      this.normalizeString(profile.refreshTokenEncrypted) ||
      this.normalizeString(settings.accessToken) ||
      this.normalizeString(settings.token) ||
      this.normalizeString(settings.apiToken) ||
      this.normalizeString(settings.access_token) ||
      this.normalizeString(this.getEnv("WECHAT_ACCESS_TOKEN")) ||
      null
    );
  }

  private async publishDirect(config: WechatPublishConfig, payload: {
    title: string;
    body: string;
    tags: string[];
    images: string[];
    settings: unknown;
    contentSettings: unknown;
  }): Promise<PublishResponse> {
    if (!payload.body && !payload.title) {
      return {
        status: "failed",
        errorMessage: "发布内容不能为空。",
      };
    }

    const tokenResult = await this.resolveAccessToken(config);
    if (!tokenResult.ok) {
      return tokenResult.response;
    }
    const token = tokenResult.token;

    const draftUrl = `${this.toFullApiUrl(config.apiBaseUrl ?? WechatApiProvider.DEFAULT_API_BASE_URL, WechatApiProvider.DEFAULT_DRAFT_PATH)}?access_token=${encodeURIComponent(token)}`;
    const draftPayload = {
      articles: [
        {
          title: payload.title,
          author: this.normalizeString(this.toRecord(payload.settings).author) || undefined,
          digest: this.normalizeString(payload.body.slice(0, 54)),
          content: this.toWechatHtml(payload.body),
          content_source_url: this.normalizeString(this.toRecord(payload.settings).content_source_url as string),
          thumb_media_id: this.normalizeString(this.toRecord(payload.settings).thumb_media_id as string),
          show_cover_pic: 0,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    };
    const draftResult = await this.postJson<{
      media_id?: string;
      errcode?: number;
      errmsg?: string;
      url?: string;
      publish_id?: string;
    }>(draftUrl, draftPayload, "微信公众号草稿创建失败");
    if (draftResult.status !== "published") {
      return draftResult;
    }

    const draftMediaId = draftResult.providerPostId;
    if (!draftMediaId) {
      return {
        status: "failed",
        errorMessage: "官方 API 返回草稿创建成功但未返回 media_id。",
      };
    }

    const publishUrl = `${this.toFullApiUrl(
      config.apiBaseUrl ?? WechatApiProvider.DEFAULT_API_BASE_URL,
      config.publishPath ?? WechatApiProvider.DEFAULT_PUBLISH_PATH,
    )}?access_token=${encodeURIComponent(token)}`;
    const publishPayload = { media_id: draftMediaId };
    const publishResult = await this.postJson<{
      errcode?: number;
      errmsg?: string;
      publish_id?: string;
      msg_data_id?: string;
      url?: string;
      publishId?: string;
    }>(publishUrl, publishPayload, "微信公众号发布失败");
    if (publishResult.status !== "published") {
      return publishResult;
    }

    const externalUrl =
      publishResult.externalUrl ??
      this.normalizeString(this.toRecord(publishResult).url) ??
      this.normalizeString(this.toRecord(publishResult).publishId) ??
      undefined;

    return {
      status: "published",
      providerPostId: publishResult.providerPostId,
      externalUrl,
    };
  }

  private async resolveAccessToken(config: WechatPublishConfig): Promise<
    { ok: true; token: string } | { ok: false; response: PublishResponse }
  > {
    if (config.accessToken) {
      return { ok: true, token: config.accessToken };
    }

    if (!config.appId || !config.appSecret) {
      return {
        ok: false,
        response: {
          status: "manual_required",
          manualInstruction: this.buildWechatManualInstruction("公众号未配置 accessToken 且缺少 appId/appSecret，无法执行官方 API。"),
        },
      };
    }

    const tokenUrl = `${this.toFullApiUrl(config.apiBaseUrl ?? WechatApiProvider.DEFAULT_API_BASE_URL, WechatApiProvider.DEFAULT_TOKEN_PATH)}&appid=${encodeURIComponent(
      config.appId,
    )}&secret=${encodeURIComponent(config.appSecret)}`;

    try {
      const response = await fetch(tokenUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const responseText = await response.text();
      const parsed = this.parseJson(responseText);
      if (!parsed) {
        return {
          ok: false,
          response: {
            status: "failed",
            errorMessage: `微信 token 获取返回非 JSON：${responseText.slice(0, 300)}`,
          },
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          response: this.handleWechatHttpError(response.status, this.toRecord(parsed), responseText),
        };
      }
      const data = this.toRecord(parsed);
      const errorCode = this.toNumber(data.errcode);
      if (errorCode !== null && errorCode !== 0) {
        return {
          ok: false,
          response: this.mapWechatErrorCode(errorCode, this.normalizeString(data.errmsg), response.status, responseText),
        };
      }
      const token = this.normalizeString(data.access_token);
      if (!token) {
        return {
          ok: false,
          response: {
            status: "failed",
            errorMessage: `微信 token 获取失败：${this.normalizeString(data.errmsg) || responseText.slice(0, 300)}`,
          },
        };
      }
      return { ok: true, token };
    } catch (error) {
      return {
        ok: false,
        response: {
          status: "failed",
          errorMessage: `微信 token 获取失败：${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  private async postJson<T extends Record<string, unknown>>(
    url: string,
    body: Record<string, unknown>,
    context: string,
  ): Promise<PublishResponse> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const responseText = await response.text();
      const parsed = this.parseJson(responseText);
      if (!parsed) {
        return {
          status: "failed",
          errorMessage: `${context}：返回非 JSON 响应 ${responseText.slice(0, 300)}`,
        };
      }
      const data = this.toRecord(parsed) as T;
      const errorCode = this.toNumber(data.errcode);
      if (!response.ok || (errorCode !== null && errorCode !== 0)) {
        return this.mapWechatErrorCode(errorCode ?? 500, this.normalizeString(data.errmsg), response.status, responseText);
      }
      const outcome = this.extractWechatPublishResult(data);
      return {
        status: "published",
        providerPostId: outcome.id,
        externalUrl: outcome.url,
      };
    } catch (error) {
      return {
        status: "failed",
        errorMessage: `${context}：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private handleWechatHttpError(status: number, payload: Record<string, unknown>, rawText: string): PublishResponse {
    const message = this.normalizeString(payload.errmsg) || this.normalizeString(payload.error) || rawText || "微信网关错误";
    if (status === 401 || status === 403) {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction(`微信鉴权失败（HTTP ${status}）：${message}`),
      };
    }
    if (status === 429) {
      return {
        status: "failed",
        errorMessage: `微信接口限流（HTTP ${status}）：${message}`,
      };
    }
    return {
      status: "failed",
      errorMessage: `微信请求失败（HTTP ${status}）：${message}`,
    };
  }

  private mapWechatErrorCode(
    code: number,
    errmsg: string | null | undefined,
    status = 200,
    rawText = "",
  ): PublishResponse {
    const normalized = errmsg || `错误码 ${code}`;
    if (code === 40001 || code === 40014 || code === 42001 || code === 42002 || code === 41001) {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction(`微信授权异常（错误码 ${code}）：${normalized}`),
      };
    }
    if (status === 429 || code === 45009) {
      return {
        status: "failed",
        errorMessage: `微信接口返回失败（错误码 ${code}）：${normalized}${rawText ? ` / ${rawText.slice(0, 200)}` : ""}`,
      };
    }
    if (status >= 500) {
      return {
        status: "failed",
        errorMessage: `微信接口错误（HTTP ${status}，错误码 ${code}）：${normalized}`,
      };
    }
    return {
      status: "failed",
      errorMessage: `微信 API 返回失败（错误码 ${code}）：${normalized}`,
    };
  }

  private async publishViaBridge(config: WechatPublishConfig, payload: {
    title: string;
    body: string;
    tags: string[];
    images: string[];
    settings: unknown;
    contentSettings: unknown;
  }): Promise<PublishResponse> {
    const gatewayUrl = this.toFullGatewayUrl(config.gatewayUrl ?? "", WechatApiProvider.DEFAULT_GATEWAY_PATH);
    if (!gatewayUrl) {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction("微信公众号网关地址未配置。"),
      };
    }

    const timeoutMs = config.cliTimeoutMs ?? WechatApiProvider.DEFAULT_CLI_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          title: payload.title,
          body: payload.body,
          tags: payload.tags,
          images: payload.images,
          settings: payload.settings,
          contentSettings: payload.contentSettings,
          source: "marketing-platform",
          platform: "wechat_official_account",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const responseText = await response.text();
      const parsed = this.parseJson(responseText);
      if (!response.ok) {
        return this.handleWechatHttpError(response.status, this.toRecord(parsed), responseText);
      }
      if (!parsed) {
        return {
          status: "failed",
          errorMessage: `微信网关返回非 JSON 响应：${responseText.slice(0, 300)}`,
        };
      }
      const outcome = this.extractWechatPublishResult(parsed);
      if (outcome.id || outcome.url) {
        return {
          status: "published",
          providerPostId: outcome.id,
          externalUrl: outcome.url,
        };
      }
      return {
        status: "failed",
        errorMessage: `微信网关返回成功，但未识别到发布结果：${responseText.slice(0, 300)}`,
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          status: "failed",
          errorMessage: `微信网关请求超时（${timeoutMs}ms）：${gatewayUrl}`,
        };
      }
      return {
        status: "failed",
        errorMessage: `微信网关请求失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async publishViaCli(config: WechatPublishConfig, payload: {
    title: string;
    body: string;
    tags: string[];
    images: string[];
    settings: unknown;
    contentSettings: unknown;
  }): Promise<PublishResponse> {
    if (!config.cliCommand) {
      return {
        status: "manual_required",
        manualInstruction: this.buildWechatManualInstruction("CLI 命令未配置。"),
      };
    }

    const timeoutMs = config.cliTimeoutMs ?? WechatApiProvider.DEFAULT_CLI_TIMEOUT_MS;
    const args = ["publish", "--json", "--title", payload.title, "--content", payload.body, "--platform", "wechat"];
    if (payload.tags.length > 0) {
      args.push("--tags", payload.tags.join(","));
    }
    if (payload.images.length > 0) {
      args.push("--images", payload.images.join(","));
    }
    if (config.cliCookieString) {
      args.push("--cookie-string", config.cliCookieString);
    }
    if (config.cliProfilePath) {
      args.push("--chrome-profile", config.cliProfilePath);
    }

    const commandResult = await this.runCommand(config.cliCommand, args, timeoutMs);
    if (commandResult.timedOut) {
      return {
        status: "failed",
        errorMessage: `CLI 调用超时（${timeoutMs}ms）：${config.cliCommand}`,
      };
    }
    if (!commandResult.ok) {
      const exitCode = commandResult.code;
      const exitCodeText = exitCode === null ? "未返回退出码" : String(exitCode);
      return {
        status: "manual_required",
        manualInstruction: this.buildCliFailureManualInstruction(
          `${config.cliCommand} 执行失败（退出码: ${exitCodeText}）：${commandResult.stderr.slice(0, 300) || "未返回 stderr"}`,
        ),
      };
    }

    const parsed = this.extractLastJson(commandResult.stdout) || this.extractLastJson(commandResult.stderr);
    if (!parsed) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliInvalidJsonManualInstruction("CLI 未返回可解析 JSON。"),
      };
    }

    const outcome = this.extractWechatPublishResult(parsed);
    if (!outcome.id && !outcome.url) {
      return {
        status: "manual_required",
        manualInstruction: this.buildCliMissingResultManualInstruction(`CLI 未返回发布结果：${(commandResult.stdout || commandResult.stderr).slice(0, 300)}`),
      };
    }
    return {
      status: "published",
      providerPostId: outcome.id,
      externalUrl: outcome.url,
    };
  }

  private buildWechatManualInstruction(message: string): PublishManualInstruction {
    return {
      title: "微信公众号自动发布未就绪",
      steps: [
        message,
        "建议优先走官方 API：appId + appSecret 或 token。",
        "如使用网关模式，设置 publishGatewayUrl 并提供 POST /api/wechat/publish。",
        "如使用 CLI 模式，确保命令返回 JSON（至少 id 或 url）。",
      ],
      checkList: [
        "已配置 publishMode/官方凭据或网关地址/CLI 命令。",
        "账号配置中有可识别的 token / cookie / appId+appSecret。",
        "接口响应可解析出 id 或 url。",
      ],
      notes: ["官方 API 会执行草稿创建 + 提交发布。"],
    };
  }

  private toWechatHtml(input: string) {
    const lines = this.normalizeString(input)?.split("\n").map((line) => line.trim()) ?? [];
    return lines.map((line) => `<p>${this.escapeHtml(line)}</p>`).join("");
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private extractWechatPublishResult(payload: unknown): WechatPublishTarget {
    const values = [this.toRecord(payload), this.toRecord(this.toRecord(payload).data), this.toRecord(this.toRecord(payload).result)];
    for (const value of values) {
      const id = this.normalizeString(
        value.media_id ||
          value.publish_id ||
          value.publishId ||
          value.msg_data_id ||
          value.msgDataId ||
          value.id ||
          this.toRecord(value.data).media_id ||
          this.toRecord(value.data).publish_id ||
          this.toRecord(value.data).publishId,
      );
      const url = this.normalizeString(
        value.url ||
          value.link ||
          value.msg_url ||
          value.share_url ||
          value.shareUrl ||
          this.toRecord(value.data).url ||
          this.toRecord(value.data).link,
      );
      if (id || url) {
        return { id, url };
      }
    }
    return {};
  }

  private toRecord(value: unknown) {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  }

  private normalizeTags(tags: unknown) {
    if (typeof tags === "string") {
      return tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (Array.isArray(tags)) {
      return tags.map((item) => this.normalizeString(item)).filter(Boolean) as string[];
    }
    return [];
  }

  private extractMediaPaths(media: unknown) {
    if (!Array.isArray(media)) {
      return [];
    }
    const candidates: string[] = [];
    for (const item of media) {
      const node = this.toRecord(item);
      const mediaAsset = this.toRecord(node.mediaAsset);
      const path = this.normalizeString(mediaAsset.path || node.path || node.url || mediaAsset.url || node.src);
      if (path) {
        candidates.push(path);
      }
    }
    return [...new Set(candidates)];
  }

  private toNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return null;
    }
    const numberValue = Number(normalized);
    if (!Number.isFinite(numberValue)) {
      return null;
    }
    return numberValue;
  }

  private toFullApiUrl(base: string, fallbackPath: string) {
    const normalizedBase = base.trim().replace(/\/$/, "");
    const normalizedPath = fallbackPath.replace(/^\//, "");
    return `${normalizedBase}/${normalizedPath}`;
  }

  private toFullGatewayUrl(base: string, fallbackPath: string) {
    const url = base.trim().replace(/\/$/, "");
    if (!url) {
      return "";
    }
    if (url.includes("://")) {
      return `${url}${url.endsWith("/") ? "" : "/"}${url.endsWith(fallbackPath) ? "" : fallbackPath.replace(/^\//, "")}`;
    }
    return `${url}${url.endsWith("/") ? "" : "/"}${fallbackPath.replace(/^\//, "")}`;
  }

  private parseJson(text: string): unknown | null {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private extractLastJson(text: string) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      const json = this.parseJson(line);
      if (json) {
        return json;
      }
    }
    return null;
  }

  private runCommand(command: string, args: string[], timeoutMs: number) {
    return new Promise<{
      ok: boolean;
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk: { toString: () => string }) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: { toString: () => string }) => {
        stderr += chunk.toString();
      });
      child.on("error", (error: { code?: string }) => {
        clearTimeout(timeout);
        if (error.code === "ENOENT") {
          resolve({
            ok: false,
            code: -1,
            stdout,
            stderr: `命令不存在：${command}`,
            timedOut: false,
          });
          return;
        }
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeout);
        resolve({
          ok: !timedOut && code === 0,
          code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  private toPositiveInt(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = Math.floor(value);
      return parsed > 1000 ? parsed : undefined;
    }

    const normalized = this.normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 1000) {
      return undefined;
    }
    return Math.floor(parsed);
  }
}

export const providerFactories: Record<ProviderPlatform, () => PublishProvider> = {
  xiaohongshu: () => new XiaohongshuApiProvider(),
  zhihu: () => new ZhihuApiProvider(),
  wechat_official_account: () => new WechatApiProvider(),
  x_twitter: () => new TwitterProvider(),
};

export function getProvider(platform: ProviderPlatform): PublishProvider {
  return providerFactories[platform]();
}
