#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

const REQUIRED_ENV = ["DATABASE_URL", "REDIS_URL", "API_URL", "PUBLISH_QUEUE_NAME"];
const APP_PORTS_REQUIRED = process.env.MARKETING_ENV_CHECK_REQUIRE_APPS === "1";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, values: {} };
  }

  const values = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return { exists: true, values };
}

function parseUrl(value, fallbackProtocol) {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`${fallbackProtocol}://${value}`);
    } catch {
      return null;
    }
  }
}

function tcpCheck(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok, message) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, "listening"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => {
      if (error.code === "EPERM") {
        const fallback = ncCheck(host, port, timeoutMs);
        finish(fallback.ok, fallback.message);
        return;
      }
      finish(false, error.code || error.message);
    });
  });
}

function ncCheck(host, port, timeoutMs) {
  const result = spawnSync("nc", ["-z", host, String(port)], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (result.error) {
    return { ok: false, message: result.error.code || result.error.message };
  }
  if (result.status === 0) {
    return { ok: true, message: "listening" };
  }
  if (result.signal) {
    return { ok: false, message: `nc ${result.signal}` };
  }
  const detail = (result.stderr || result.stdout || "").trim();
  return { ok: false, message: detail || "not listening" };
}

function formatLine(status, label, detail) {
  const marker = status === "ok" ? "[ok]" : status === "warn" ? "[warn]" : "[fail]";
  console.log(`${marker} ${label}${detail ? ` - ${detail}` : ""}`);
}

function normalizeHost(hostname) {
  if (!hostname || hostname === "::1") {
    return "localhost";
  }
  return hostname;
}

async function checkTcpFromUrl(label, value, defaultPort, fallbackProtocol, required) {
  const parsed = parseUrl(value, fallbackProtocol);
  if (!parsed) {
    formatLine(required ? "fail" : "warn", label, `invalid URL: ${value}`);
    return !required;
  }

  const host = normalizeHost(parsed.hostname);
  const port = Number.parseInt(parsed.port || String(defaultPort), 10);
  const result = await tcpCheck(host, port);
  formatLine(result.ok ? "ok" : required ? "fail" : "warn", label, `${host}:${port} ${result.message}`);
  return required ? result.ok : true;
}

async function main() {
  const env = readEnvFile(envPath);
  let success = true;

  if (!env.exists) {
    formatLine("fail", ".env", "missing; copy .env.example and adjust local values");
    success = false;
  } else {
    formatLine("ok", ".env", envPath);
  }

  for (const key of REQUIRED_ENV) {
    if (!env.values[key]) {
      formatLine("fail", key, "missing or empty");
      success = false;
    } else {
      formatLine("ok", key, "set");
    }
  }

  if (env.values.DATABASE_URL) {
    const ok = await checkTcpFromUrl("PostgreSQL", env.values.DATABASE_URL, 5432, "postgresql", true);
    success = success && ok;
  }

  if (env.values.REDIS_URL) {
    const ok = await checkTcpFromUrl("Redis", env.values.REDIS_URL, 6379, "redis", true);
    success = success && ok;
  }

  if (env.values.API_URL) {
    const ok = await checkTcpFromUrl("API", env.values.API_URL, 4000, "http", APP_PORTS_REQUIRED);
    success = success && ok;
  }

  if (env.values.WEB_URL) {
    const ok = await checkTcpFromUrl("Web", env.values.WEB_URL, 3000, "http", APP_PORTS_REQUIRED);
    success = success && ok;
  }

  if (!success) {
    console.error("Local environment is not ready for the publish smoke loop.");
    process.exit(1);
  }

  console.log("Local environment is ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
