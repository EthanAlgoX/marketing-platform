"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type Platform = "xiaohongshu" | "zhihu" | "wechat_official_account" | "x_twitter";
type ContentType =
  | "original"
  | "note"
  | "article"
  | "answer"
  | "idea"
  | "wechat_article"
  | "tweet"
  | "thread";

type ContentItem = {
  id: string;
  title: string;
  sourceContent: string | null;
  organizationId: string;
  versions: ContentVersion[];
};

type ContentVersion = {
  id: string;
  platform: Platform;
  contentType: ContentType;
  title: string | null;
  body: string | null;
  createdAt: string;
};

type PlatformAccessType = "official_api" | "draft_api" | "browser_assist" | "manual";

type PlatformAccount = {
  id: string;
  platform: Platform;
  displayName: string;
  username: string | null;
  accessType?: PlatformAccessType | null;
  tokenEncrypted?: string | null;
  settings?: Record<string, unknown> | null;
};

type PublishTarget = {
  id: string;
  platformAccount: PlatformAccount;
  contentVersion: {
    id: string;
    platform: Platform;
    title: string | null;
  };
  status: string;
  externalUrl?: string;
  manualInstruction?: {
    instruction?: string | { title?: string };
  };
  result?: {
    externalUrl?: string | null;
    providerPostId?: string | null;
  };
  errors?: Array<{
    errorType: string;
    errorMessage: string;
  }>;
};

type PublishTask = {
  id: string;
  status: string;
  contentItemId: string;
  startedAt: string | null;
  finishedAt: string | null;
  targets: PublishTarget[];
};

const PLATFORMS: Platform[] = ["xiaohongshu", "zhihu", "x_twitter", "wechat_official_account"];
const CONTENT_TYPES: ContentType[] = ["note", "article", "tweet", "answer", "thread", "wechat_article", "idea", "original"];

const PLATFORM_META: Record<
  Platform,
  {
    name: string;
    mark: string;
    accent: string;
    intent: string;
    format: string;
    defaultContentType: ContentType;
  }
> = {
  xiaohongshu: {
    name: "小红书",
    mark: "RED",
    accent: "#c24150",
    intent: "种草笔记",
    format: "生活化标题、短段落、收藏评论引导",
    defaultContentType: "note",
  },
  zhihu: {
    name: "知乎",
    mark: "ZHI",
    accent: "#2563eb",
    intent: "理性回答",
    format: "问题切入、结构化论点、讨论引导",
    defaultContentType: "article",
  },
  x_twitter: {
    name: "X",
    mark: "X",
    accent: "#111827",
    intent: "短观点",
    format: "一句主张、强观点、转评扩散",
    defaultContentType: "tweet",
  },
  wechat_official_account: {
    name: "公众号",
    mark: "WX",
    accent: "#059669",
    intent: "品牌长文",
    format: "标题承诺、信息密度、阅读转化",
    defaultContentType: "wechat_article",
  },
};

const ACCESS_TYPE_LABELS: Record<PlatformAccessType, string> = {
  manual: "人工发布",
  official_api: "官方 API",
  draft_api: "草稿 API",
  browser_assist: "浏览器辅助",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  scheduled: "已排期",
  processing: "处理中",
  success: "成功",
  failed: "失败",
  pending: "待执行",
  manual_required: "待回填",
  skipped: "已跳过",
  canceled: "已取消",
};

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message?: string }).message)
        : text;
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function statusClass(status: string) {
  if (status === "success") return "success";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "manual_required" || status === "scheduled") return "warning";
  if (status === "processing" || status === "pending" || status === "draft") return "info";
  return "";
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function platformStyle(platform: Platform): CSSProperties {
  return { "--platform-accent": PLATFORM_META[platform].accent } as CSSProperties;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function formatDate(value: string | null) {
  if (!value) return "未开始";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function newestVersionForPlatform(versions: ContentVersion[], platform: Platform) {
  return versions.find((version) => version.platform === platform);
}

export default function HomePage() {
  const [apiBase, setApiBase] = useState("http://localhost:4000/api");
  const [userId, setUserId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [message, setMessage] = useState<string>("");

  const [createUserEmail, setCreateUserEmail] = useState("");
  const [createOrgName, setCreateOrgName] = useState("");

  const [contentTitle, setContentTitle] = useState("春季新品推广素材");
  const [sourceContent, setSourceContent] = useState("我们发布了一款新的智能营销工具，主打一稿多发与多平台适配。");
  const [productInfo, setProductInfo] = useState("AI 内容适配发布平台");
  const [targetAudience, setTargetAudience] = useState("内容运营人员");
  const [marketingGoal, setMarketingGoal] = useState("提升品牌认知");

  const [versionPlatforms, setVersionPlatforms] = useState<Record<Platform, boolean>>({
    xiaohongshu: true,
    zhihu: true,
    x_twitter: true,
    wechat_official_account: false,
  });
  const [versionContentTypes, setVersionContentTypes] = useState<Record<Platform, ContentType>>({
    xiaohongshu: "note",
    zhihu: "article",
    x_twitter: "tweet",
    wechat_official_account: "wechat_article",
  });
  const [contentItem, setContentItem] = useState<ContentItem | null>(null);

  const [platformAccounts, setPlatformAccounts] = useState<PlatformAccount[]>([]);
  const [platformAccountDisplayName, setPlatformAccountDisplayName] = useState("");
  const [platformAccountPlatform, setPlatformAccountPlatform] = useState<Platform>("xiaohongshu");
  const [platformAccountUsername, setPlatformAccountUsername] = useState("");
  const [platformAccountAccessType, setPlatformAccountAccessType] = useState<PlatformAccessType>("manual");
  const [platformAccountToken, setPlatformAccountToken] = useState("");
  const [platformAccountRefreshToken, setPlatformAccountRefreshToken] = useState("");
  const [platformAccountTokenExpiresAt, setPlatformAccountTokenExpiresAt] = useState("");
  const [platformAccountPublishGatewayUrl, setPlatformAccountPublishGatewayUrl] = useState("");
  const [platformAccountCliCommand, setPlatformAccountCliCommand] = useState("");
  const [platformAccountCliTimeoutMs, setPlatformAccountCliTimeoutMs] = useState("");
  const [platformAccountCookieString, setPlatformAccountCookieString] = useState("");
  const [platformAccountChromeProfile, setPlatformAccountChromeProfile] = useState("");

  const [taskTargets, setTaskTargets] = useState<Record<string, string>>({});
  const [publishTasks, setPublishTasks] = useState<PublishTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<PublishTask | null>(null);
  const [manualInstruction, setManualInstruction] = useState<Record<string, string>>({
    externalUrl: "",
    providerPostId: "",
    note: "",
  });

  const [isBusy, setIsBusy] = useState(false);

  const resolveUrl = (path: string) => {
    const normalizedBase = apiBase.replace(/\/$/, "");
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  };

  const activeTaskState = useMemo(() => {
    return publishTasks.find((item) => item.id === activeTaskId) ?? activeTask;
  }, [publishTasks, activeTaskId, activeTask]);

  const selectedPlatformCount = useMemo(() => {
    return PLATFORMS.filter((platform) => versionPlatforms[platform]).length;
  }, [versionPlatforms]);

  const selectedTargetCount = useMemo(() => {
    return Object.values(taskTargets).filter(Boolean).length;
  }, [taskTargets]);

  const manualRequiredCount = useMemo(() => {
    return activeTaskState?.targets.filter((target) => target.status === "manual_required").length ?? 0;
  }, [activeTaskState]);

  const withUserHeaders = () => ({
    "x-user-id": userId,
    "content-type": "application/json",
  });

  async function apiGet<T>(path: string, requireAuth = true): Promise<T> {
    const headers = {
      ...(requireAuth ? withUserHeaders() : { "content-type": "application/json" }),
    };
    const response = await fetch(resolveUrl(`${path.startsWith("/") ? path : `/${path}`}`), {
      method: "GET",
      headers,
    });
    return readResponse<T>(response);
  }

  async function apiPost<T>(path: string, body: unknown, requireAuth = true): Promise<T> {
    const headers = {
      ...(requireAuth ? withUserHeaders() : { "content-type": "application/json" }),
      ...(requireAuth ? { "content-type": "application/json" } : {}),
    };
    const response = await fetch(resolveUrl(`${path.startsWith("/") ? path : `/${path}`}`), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return readResponse<T>(response);
  }

  async function apiPatch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(resolveUrl(`${path.startsWith("/") ? path : `/${path}`}`), {
      method: "PATCH",
      headers: {
        ...withUserHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return readResponse<T>(response);
  }

  async function safe<T>(task: () => Promise<T>, doneMessage?: string) {
    setIsBusy(true);
    try {
      const result = await task();
      if (doneMessage) {
        setMessage(doneMessage);
      }
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "request failed");
      return null as unknown as T;
    } finally {
      setIsBusy(false);
    }
  }

  const loadContent = async () => {
    if (!userId) {
      setMessage("请先填入 x-user-id");
      return;
    }

    const list = await safe(() => apiGet<ContentItem[]>(`/content?organizationId=${organizationId}`, Boolean(organizationId)));
    if (list && list.length) {
      setContentItem(list[0] ?? null);
    }
  };

  const loadAccounts = async () => {
    if (!userId || !organizationId) {
      return;
    }

    const list = await safe(() => apiGet<PlatformAccount[]>(`/platform-accounts?organizationId=${organizationId}`));
    setPlatformAccounts(list ?? []);
  };

  const loadPublishTasks = async () => {
    if (!userId) {
      return;
    }

    const q = organizationId ? `?organizationId=${organizationId}` : "";
    const list = await safe(() => apiGet<PublishTask[]>(`/publish-tasks${q}`));
    setPublishTasks(list ?? []);
  };

  const loadTaskDetail = async (taskId: string) => {
    const task = await safe(() => apiGet<PublishTask>(`/publish-tasks/${taskId}`));
    if (task) {
      setActiveTask(task);
      setActiveTaskId(task.id);
      setPublishTasks((prev) => {
        const exists = prev.some((item) => item.id === task.id);
        return exists ? prev.map((item) => (item.id === task.id ? task : item)) : [task, ...prev];
      });
    }
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!createUserEmail) {
      return;
    }

    const user = await safe(() => apiPost<{ id: string }>("/users", { email: createUserEmail }, false), "用户创建成功");
    if (user?.id) {
      setUserId(user.id);
      setCreateUserEmail("");
    }
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId || !createOrgName) {
      return;
    }

    const org = await safe(
      () => apiPost<{ id: string; name: string }>("/organizations", { name: createOrgName, ownerUserId: userId }, false),
      "组织创建成功",
    );
    if (org?.id) {
      setOrganizationId(org.id);
      setCreateOrgName("");
    }
  };

  const createContent = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) {
      setMessage("请先填写 organizationId");
      return;
    }

    const item = await safe(
      () =>
        apiPost<ContentItem>("/content", {
          organizationId,
          title: contentTitle,
          sourceContent,
          productInfo,
          targetAudience,
          marketingGoal,
        }),
      "内容创建成功",
    );
    if (item?.id) {
      setContentItem(item);
      await loadContent();
    }
  };

  const createVersions = async () => {
    if (!contentItem) {
      setMessage("请先创建内容");
      return;
    }

    const versions = PLATFORMS.filter((platform) => versionPlatforms[platform]).map((platform) => ({
      platform,
      contentType: versionContentTypes[platform],
    }));

    if (!versions.length) {
      setMessage("请至少选择一个平台");
      return;
    }

    const updated = await safe(
      () =>
        apiPost<{ id?: string; contentItemId?: string; createdVersions: ContentVersion[] }>(`/content/${contentItem.id}/versions/ai`, {
          organizationId,
          versions,
        }),
      "AI 版本生成完成",
    );
    const updatedContentItemId = updated?.id ?? updated?.contentItemId;
    if (updatedContentItemId) {
      const detail = await safe(() => apiGet<ContentItem>(`/content/${updatedContentItemId}`));
      if (detail) {
        setContentItem(detail);
        setTaskTargets({});
      }
    }
  };

  const addAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) {
      setMessage("请先填写 organizationId");
      return;
    }
    const bridgeOrCliPlatform =
      platformAccountPlatform === "xiaohongshu" || platformAccountPlatform === "zhihu" || platformAccountPlatform === "wechat_official_account";
    if (bridgeOrCliPlatform && platformAccountAccessType === "browser_assist" && !platformAccountCliCommand) {
      setMessage("browser_assist 模式需要配置 CLI 命令");
      return;
    }

    const resolvedPublishMode = bridgeOrCliPlatform
      ? platformAccountAccessType === "official_api" || platformAccountAccessType === "draft_api"
        ? "bridge"
        : platformAccountAccessType === "browser_assist"
          ? "cli"
          : undefined
      : undefined;
    const parsedCliTimeoutMs = platformAccountCliTimeoutMs ? Number.parseInt(platformAccountCliTimeoutMs, 10) : undefined;

    if (platformAccountCliTimeoutMs && Number.isNaN(parsedCliTimeoutMs)) {
      setMessage("cliTimeoutMs 需要输入有效数字");
      return;
    }

    const settings = bridgeOrCliPlatform
      ? {
          ...(resolvedPublishMode ? { publishMode: resolvedPublishMode } : {}),
          ...(platformAccountPublishGatewayUrl ? { publishGatewayUrl: platformAccountPublishGatewayUrl } : {}),
          ...(platformAccountCliCommand ? { cliCommand: platformAccountCliCommand } : {}),
          ...(typeof parsedCliTimeoutMs === "number" ? { cliTimeoutMs: parsedCliTimeoutMs } : {}),
          ...(platformAccountCookieString ? { cookieString: platformAccountCookieString } : {}),
          ...(platformAccountChromeProfile ? { chromeProfile: platformAccountChromeProfile } : {}),
        }
      : {};

    const account = await safe(
      () =>
        apiPost<PlatformAccount>("/platform-accounts", {
          organizationId,
          platform: platformAccountPlatform,
          displayName: platformAccountDisplayName,
          username: platformAccountUsername || undefined,
          accessType: platformAccountAccessType,
          tokenEncrypted: platformAccountToken || undefined,
          refreshTokenEncrypted: platformAccountRefreshToken || undefined,
          tokenExpiresAt: platformAccountTokenExpiresAt || undefined,
          settings,
          authStatus: "active",
        }),
      "平台账号已创建",
    );
    if (account) {
      setPlatformAccounts((prev) => [account, ...prev]);
      setPlatformAccountDisplayName("");
      setPlatformAccountUsername("");
      setPlatformAccountAccessType("manual");
      setPlatformAccountToken("");
      setPlatformAccountRefreshToken("");
      setPlatformAccountTokenExpiresAt("");
      setPlatformAccountPublishGatewayUrl("");
      setPlatformAccountCliCommand("");
      setPlatformAccountCliTimeoutMs("");
      setPlatformAccountCookieString("");
      setPlatformAccountChromeProfile("");
    }
  };

  const createPublishTask = async () => {
    if (!contentItem || !organizationId) {
      setMessage("请先选择内容");
      return;
    }

    const selectedTargetRows = contentItem.versions
      .map((version) => {
        const accountId = taskTargets[version.id];
        if (!accountId) {
          return null;
        }
        return { platformAccountId: accountId, contentVersionId: version.id };
      })
      .filter(Boolean) as Array<{ platformAccountId: string; contentVersionId: string }>;

    if (!selectedTargetRows.length) {
      setMessage("请为至少一个版本选择对应平台账号");
      return;
    }

    const result = await safe(
      () =>
        apiPost<{ id: string }>("/publish-tasks", {
          organizationId,
          contentItemId: contentItem.id,
          targets: selectedTargetRows,
        }),
      "发布任务已创建",
    );

    if (result?.id) {
      setActiveTaskId(result.id);
      await loadPublishTasks();
      await loadTaskDetail(result.id);
    }
  };

  const runPublishTask = async () => {
    if (!activeTaskId) {
      setMessage("请先创建发布任务");
      return;
    }

    await safe(() => apiPost(`/publish-tasks/${activeTaskId}/run`, {}, true), "发布任务已入队（异步执行）");
    await pollTask(activeTaskId);
  };

  const pollTask = async (taskId: string) => {
    const poll = async () => {
      await loadTaskDetail(taskId);
      const latest = await apiGet<PublishTask>(`/publish-tasks/${taskId}`);
      if (latest.status === "processing" || latest.status === "draft" || latest.status === "scheduled") {
        setTimeout(() => void poll(), 2000);
      }
    };

    await poll();
  };

  const completeManual = async (target: PublishTarget) => {
    const payload = {
      externalUrl: manualInstruction.externalUrl,
      providerPostId: manualInstruction.providerPostId || undefined,
      note: manualInstruction.note,
    };

    if (!payload.externalUrl) {
      setMessage("请输入外部链接");
      return;
    }

    if (!activeTaskId) {
      setMessage("请先选择当前任务");
      return;
    }

    await safe(() => apiPatch(`/publish-tasks/${activeTaskId}/targets/${target.id}/manual-complete`, payload));
    await loadTaskDetail(activeTaskId);
  };

  useEffect(() => {
    if (userId && organizationId) {
      void loadContent();
      void loadAccounts();
      void loadPublishTasks();
    }
  }, [userId, organizationId]);

  useEffect(() => {
    setManualInstruction({ externalUrl: "", providerPostId: "", note: "" });
  }, [activeTaskId]);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div>
          <div className="eyebrow">Marketing Platform</div>
          <h1 className="app-title">多平台内容适配发布工作台</h1>
          <p className="app-subtitle">把一份营销内容优化成不同平台的表达版本，绑定账号后创建发布任务，并完成自动执行或人工链接回填。</p>
        </div>
        <div className="metric-strip" aria-label="当前链路统计">
          <div className="metric">
            <span>目标平台</span>
            <strong>{selectedPlatformCount}</strong>
          </div>
          <div className="metric">
            <span>已生成版本</span>
            <strong>{contentItem?.versions?.length ?? 0}</strong>
          </div>
          <div className="metric">
            <span>待回填</span>
            <strong>{manualRequiredCount}</strong>
          </div>
        </div>
      </header>

      <div className="workbench">
        <aside className="panel">
          <div className="panel-header">
            <h2>工作区</h2>
            <button className="ghost" type="button" onClick={() => void loadPublishTasks()} disabled={isBusy || !userId}>
              刷新
            </button>
          </div>
          <div className="panel-body">
            <div className="stack">
              <label>
                API 地址
                <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="http://localhost:4000/api" />
              </label>
              <label>
                x-user-id
                <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user-id" />
              </label>
              <label>
                organizationId
                <input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} placeholder="organization-id" />
              </label>
              <div className="button-row">
                <button className="secondary" type="button" onClick={() => void loadContent()} disabled={isBusy || !userId}>
                  载入内容
                </button>
                <button className="secondary" type="button" onClick={() => void loadAccounts()} disabled={isBusy || !userId || !organizationId}>
                  载入账号
                </button>
              </div>
            </div>

            <div className="quick-create">
              <form className="inline-form" onSubmit={createUser}>
                <label>
                  创建用户
                  <input value={createUserEmail} onChange={(event) => setCreateUserEmail(event.target.value)} placeholder="user@example.com" />
                </label>
                <button disabled={isBusy || !createUserEmail}>创建</button>
              </form>
              <form className="inline-form" onSubmit={createOrganization}>
                <label>
                  创建组织
                  <input value={createOrgName} onChange={(event) => setCreateOrgName(event.target.value)} placeholder="组织名" />
                </label>
                <button disabled={isBusy || !createOrgName || !userId}>创建</button>
              </form>
            </div>

            <form className="stack" onSubmit={addAccount}>
              <div className="section-title">
                <h2>发布账号</h2>
                <span className="pill">{platformAccounts.length} 个</span>
              </div>
              <div className="field-grid">
                <label>
                  平台
                  <select value={platformAccountPlatform} onChange={(event) => setPlatformAccountPlatform(event.target.value as Platform)}>
                    {PLATFORMS.map((platform) => (
                      <option key={platform} value={platform}>
                        {PLATFORM_META[platform].name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  接入方式
                  <select
                    value={platformAccountAccessType}
                    onChange={(event) => setPlatformAccountAccessType(event.target.value as PlatformAccessType)}
                  >
                    {Object.entries(ACCESS_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                账号展示名
                <input value={platformAccountDisplayName} onChange={(event) => setPlatformAccountDisplayName(event.target.value)} placeholder="品牌主账号" />
              </label>
              <label>
                用户名
                <input value={platformAccountUsername} onChange={(event) => setPlatformAccountUsername(event.target.value)} placeholder="可选" />
              </label>
              <details>
                <summary>高级接入参数</summary>
                <div className="details-body">
                  <label>
                    access token
                    <input value={platformAccountToken} onChange={(event) => setPlatformAccountToken(event.target.value)} placeholder="tokenEncrypted" />
                  </label>
                  <label>
                    refresh token
                    <input
                      value={platformAccountRefreshToken}
                      onChange={(event) => setPlatformAccountRefreshToken(event.target.value)}
                      placeholder="可选"
                    />
                  </label>
                  <label>
                    token 过期时间
                    <input
                      value={platformAccountTokenExpiresAt}
                      onChange={(event) => setPlatformAccountTokenExpiresAt(event.target.value)}
                      placeholder="2026-07-05T00:00:00.000Z"
                    />
                  </label>
                  <label>
                    发布网关
                    <input
                      value={platformAccountPublishGatewayUrl}
                      onChange={(event) => setPlatformAccountPublishGatewayUrl(event.target.value)}
                      placeholder="publishGatewayUrl"
                    />
                  </label>
                  <label>
                    CLI 命令
                    <input value={platformAccountCliCommand} onChange={(event) => setPlatformAccountCliCommand(event.target.value)} placeholder="redbook" />
                  </label>
                  <label>
                    CLI 超时毫秒
                    <input
                      value={platformAccountCliTimeoutMs}
                      onChange={(event) => setPlatformAccountCliTimeoutMs(event.target.value)}
                      placeholder="30000"
                    />
                  </label>
                  <label>
                    Cookie
                    <input
                      value={platformAccountCookieString}
                      onChange={(event) => setPlatformAccountCookieString(event.target.value)}
                      placeholder="cookieString"
                    />
                  </label>
                  <label>
                    Chrome Profile
                    <input
                      value={platformAccountChromeProfile}
                      onChange={(event) => setPlatformAccountChromeProfile(event.target.value)}
                      placeholder="chromeProfile"
                    />
                  </label>
                </div>
              </details>
              <button disabled={isBusy || !organizationId || !platformAccountDisplayName}>添加账号</button>
            </form>

            <ul className="account-list">
              {platformAccounts.length ? (
                platformAccounts.map((account) => (
                  <li className="account-row" key={account.id}>
                    <strong>
                      {PLATFORM_META[account.platform].name} / {account.displayName}
                    </strong>
                    <span className="meta-line">
                      {account.username || "未填写用户名"} · {account.accessType ? ACCESS_TYPE_LABELS[account.accessType] : "未配置接入"}
                      {account.tokenEncrypted ? " · 已配置 token" : ""}
                    </span>
                  </li>
                ))
              ) : (
                <li className="empty-state">暂无平台账号</li>
              )}
            </ul>

            <div className="log-panel">
              <div className="section-title">
                <h2>运行日志</h2>
                <span className={`pill ${isBusy ? "info" : "success"}`}>{isBusy ? "请求中" : "就绪"}</span>
              </div>
              <pre className="log-box">{message || "就绪"}</pre>
            </div>
          </div>
        </aside>

        <section className="panel">
          <div className="panel-header">
            <h2>内容适配</h2>
            <span className="pill">{contentItem ? `内容 ${shortId(contentItem.id)}` : "未创建内容"}</span>
          </div>
          <div className="panel-body">
            <form className="composer" onSubmit={createContent}>
              <div className="field-grid">
                <label>
                  内容标题
                  <input value={contentTitle} onChange={(event) => setContentTitle(event.target.value)} placeholder="标题" />
                </label>
                <label>
                  产品信息
                  <input value={productInfo} onChange={(event) => setProductInfo(event.target.value)} placeholder="产品信息" />
                </label>
              </div>
              <label>
                原始内容
                <textarea
                  className="source-textarea"
                  value={sourceContent}
                  onChange={(event) => setSourceContent(event.target.value)}
                  placeholder="输入要分发的营销内容"
                />
              </label>
              <div className="field-grid">
                <label>
                  目标受众
                  <input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} placeholder="内容运营人员" />
                </label>
                <label>
                  营销目标
                  <input value={marketingGoal} onChange={(event) => setMarketingGoal(event.target.value)} placeholder="提升品牌认知" />
                </label>
              </div>
              <div className="button-row">
                <button disabled={isBusy || !organizationId}>创建内容</button>
                <button className="secondary" type="button" onClick={() => void createVersions()} disabled={!contentItem || isBusy}>
                  生成平台版本
                </button>
              </div>
            </form>

            <div>
              <div className="section-title">
                <h2>平台风格</h2>
                <span className="pill">{selectedPlatformCount} 个已选</span>
              </div>
              <div className="platform-grid">
                {PLATFORMS.map((platform) => {
                  const meta = PLATFORM_META[platform];
                  return (
                    <div className={`platform-tile ${versionPlatforms[platform] ? "is-selected" : ""}`} key={platform} style={platformStyle(platform)}>
                      <div className="platform-title">
                        <div className="platform-name">
                          <span className="platform-mark">{meta.mark}</span>
                          <span className="platform-copy">
                            <strong>{meta.name}</strong>
                            <span>{meta.intent}</span>
                          </span>
                        </div>
                        <label className="toggle" aria-label={`选择 ${meta.name}`}>
                          <input
                            type="checkbox"
                            checked={versionPlatforms[platform]}
                            onChange={(event) =>
                              setVersionPlatforms((prev) => ({
                                ...prev,
                                [platform]: event.target.checked,
                              }))
                            }
                          />
                          <span />
                        </label>
                      </div>
                      <label>
                        内容形态
                        <select
                          value={versionContentTypes[platform]}
                          onChange={(event) =>
                            setVersionContentTypes((prev) => ({
                              ...prev,
                              [platform]: event.target.value as ContentType,
                            }))
                          }
                        >
                          {CONTENT_TYPES.map((contentType) => (
                            <option value={contentType} key={`${platform}-${contentType}`}>
                              {contentType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="meta-line">{meta.format}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="section-title">
                <h2>版本预览</h2>
                <span className="pill">{contentItem?.versions?.length ?? 0} 条</span>
              </div>
              {(contentItem?.versions ?? []).length ? (
                <div className="preview-grid">
                  {PLATFORMS.map((platform) => {
                    const version = newestVersionForPlatform(contentItem?.versions ?? [], platform);
                    if (!version) return null;
                    const meta = PLATFORM_META[platform];
                    return (
                      <article className="preview" key={version.id} style={platformStyle(platform)}>
                        <div className="preview-header">
                          <div className="platform-name">
                            <span className="platform-mark">{meta.mark}</span>
                            <span className="platform-copy">
                              <strong>{meta.name}</strong>
                              <span>{version.contentType}</span>
                            </span>
                          </div>
                          <span className="pill">{formatDate(version.createdAt)}</span>
                        </div>
                        <div className="preview-body">
                          <h3>{version.title || contentItem?.title || "未命名版本"}</h3>
                          <pre>{version.body || "暂无正文"}</pre>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">创建内容后生成平台版本</div>
              )}
            </div>
          </div>
        </section>

        <aside className="panel publish-column">
          <div className="panel-header">
            <h2>发布执行</h2>
            <span className={`pill ${activeTaskState ? statusClass(activeTaskState.status) : ""}`}>
              {activeTaskState ? statusLabel(activeTaskState.status) : "未创建任务"}
            </span>
          </div>
          <div className="panel-body">
            <div>
              <div className="section-title">
                <h2>版本绑定</h2>
                <span className="pill">{selectedTargetCount} 个目标</span>
              </div>
              {(contentItem?.versions ?? []).length ? (
                <div className="assignment-list">
                  {(contentItem?.versions ?? []).map((version) => {
                    const matchedAccounts = platformAccounts.filter((account) => account.platform === version.platform);
                    const meta = PLATFORM_META[version.platform];
                    return (
                      <div className="assignment-row" key={version.id} style={platformStyle(version.platform)}>
                        <div className="platform-name">
                          <span className="platform-mark">{meta.mark}</span>
                          <span className="platform-copy">
                            <strong>{version.title || contentItem?.title || "未命名版本"}</strong>
                            <span>
                              {meta.name} · {version.contentType}
                            </span>
                          </span>
                        </div>
                        <select
                          value={taskTargets[version.id] || ""}
                          onChange={(event) =>
                            setTaskTargets((prev) => ({
                              ...prev,
                              [version.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">未选择账号</option>
                          {matchedAccounts.map((account) => (
                            <option value={account.id} key={account.id}>
                              {account.displayName}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">先生成平台版本</div>
              )}
              <div className="button-row" style={{ marginTop: 12 }}>
                <button onClick={() => void createPublishTask()} disabled={isBusy || !contentItem}>
                  创建任务
                </button>
                <button className="secondary" onClick={() => void runPublishTask()} disabled={isBusy || !activeTaskId}>
                  执行任务
                </button>
              </div>
            </div>

            <div>
              <div className="section-title">
                <h2>任务列表</h2>
                <span className="pill">{publishTasks.length} 个</span>
              </div>
              <ul className="task-list">
                {publishTasks.length ? (
                  publishTasks.map((task) => (
                    <li className="task-row" key={task.id}>
                      <div className="target-head">
                        <button
                          className="ghost"
                          onClick={() => {
                            setActiveTaskId(task.id);
                            void loadTaskDetail(task.id);
                          }}
                        >
                          {shortId(task.id)}
                        </button>
                        <span className={`pill ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>
                      </div>
                      <span className="meta-line">
                        内容 {shortId(task.contentItemId)} · 目标 {task.targets.length}
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="empty-state">暂无发布任务</li>
                )}
              </ul>
            </div>

            <div>
              <div className="section-title">
                <h2>当前任务</h2>
                <span className="pill">{activeTaskState?.targets.length ?? 0} 个目标</span>
              </div>
              {activeTaskState ? (
                <div className="target-list">
                  <div className="account-row">
                    <strong>{activeTaskState.id}</strong>
                    <span className="meta-line">
                      开始 {formatDate(activeTaskState.startedAt)} · 完成 {formatDate(activeTaskState.finishedAt)}
                    </span>
                  </div>
                  {activeTaskState.targets.map((target) => {
                    const meta = PLATFORM_META[target.platformAccount.platform];
                    const manualInstructionText =
                      typeof target.manualInstruction === "object" && target.manualInstruction
                        ? JSON.stringify(target.manualInstruction).slice(0, 180)
                        : "";

                    return (
                      <div className="target" key={target.id} style={platformStyle(target.platformAccount.platform)}>
                        <div className="target-head">
                          <div className="platform-name">
                            <span className="platform-mark">{meta.mark}</span>
                            <span className="platform-copy">
                              <strong>{target.platformAccount.displayName}</strong>
                              <span>{target.contentVersion?.title || "未命名版本"}</span>
                            </span>
                          </div>
                          <span className={`pill ${statusClass(target.status)}`}>{statusLabel(target.status)}</span>
                        </div>
                        {target.result?.externalUrl ? <a href={target.result.externalUrl}>{target.result.externalUrl}</a> : null}
                        {manualInstructionText ? <pre className="meta-line">{manualInstructionText}</pre> : null}
                        {target.errors?.length ? (
                          <pre className="meta-line">{target.errors.map((error) => `${error.errorType}: ${error.errorMessage}`).join("\n")}</pre>
                        ) : null}

                        {target.status === "manual_required" ? (
                          <div className="manual-form">
                            <label>
                              发布后链接
                              <input
                                value={manualInstruction.externalUrl}
                                onChange={(event) =>
                                  setManualInstruction((prev) => ({
                                    ...prev,
                                    externalUrl: event.target.value,
                                  }))
                                }
                                placeholder="https://"
                              />
                            </label>
                            <label>
                              平台 ID
                              <input
                                value={manualInstruction.providerPostId}
                                onChange={(event) =>
                                  setManualInstruction((prev) => ({
                                    ...prev,
                                    providerPostId: event.target.value,
                                  }))
                                }
                                placeholder="可选"
                              />
                            </label>
                            <label>
                              备注
                              <input
                                value={manualInstruction.note}
                                onChange={(event) =>
                                  setManualInstruction((prev) => ({
                                    ...prev,
                                    note: event.target.value,
                                  }))
                                }
                                placeholder="可选"
                              />
                            </label>
                            <button onClick={() => void completeManual(target)}>回填链接</button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">创建或选择一个发布任务</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
