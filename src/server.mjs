#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, "..");
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");
const DEFAULT_WORKSPACE = path.join(PROJECT_ROOT, "workspace");
const DEFAULT_TIMEOUT_MS = 120000;
const CDP_TIMEOUT_MS = 8000;

const args = parseArgs(process.argv.slice(2));
const API_PORT = Number(args.port || 34891);
const CDP_PORT = Number(args.cdpPort || 9222);
const PID_FILE = args.pidFile || "";
let config = {};

async function main() {
  config = await loadConfig();
  if (PID_FILE) {
    await writeFile(PID_FILE, `${process.pid}\n`, "utf8");
  }

  const server = createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && req.url === "/health") {
        writeJson(res, 200, { ok: true, codexPath: config.codexPath || "" });
        return;
      }

      if (req.method === "POST" && req.url === "/explain") {
        const body = await readJsonBody(req);
        const text = await explain(body);
        writeJson(res, 200, { ok: true, text });
        return;
      }

      writeJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(API_PORT, "127.0.0.1", resolve);
  });
  console.log(`Selection explainer HTTP server listening on 127.0.0.1:${API_PORT}`);
  console.log(`Watching Codex CDP port ${CDP_PORT}`);

  const injectedTargets = new Set();
  let started = false;
  while (true) {
    try {
      const targets = await listTargets(CDP_PORT);
      started = true;
      for (const target of targets) {
        const isCodexPage =
          target.type === "page" &&
          target.title === "Codex" &&
          String(target.url || "").startsWith("http://127.0.0.1:");
        if (!isCodexPage) {
          continue;
        }
        if (!injectedTargets.has(target.id)) {
          try {
            await injectRenderer(target);
            injectedTargets.add(target.id);
            console.log(`Injected renderer into ${target.id} ${target.url}`);
          } catch (error) {
            console.error(`Injection failed for ${target.id}: ${error.message}`);
          }
          continue;
        }
        try {
          await processPendingRequests(target);
        } catch (error) {
          console.error(`Pending request polling failed for ${target.id}: ${error.message}`);
        }
      }
    } catch (error) {
      if (started) {
        console.log("Codex CDP endpoint is not reachable; waiting for restart...");
        started = false;
      }
    }
    await sleep(600);
  }
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) {
      continue;
    }
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      result[name] = "true";
    } else {
      result[name] = next;
      index += 1;
    }
  }
  return result;
}

async function loadConfig() {
  try {
    return JSON.parse(await readFile(DEFAULT_CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function resolveAppLanguage() {
  try {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const configPath = path.join(codexHome, "config.toml");
    const configText = await readFile(configPath, "utf8");
    const match = configText.match(/localeOverride\s*=\s*"([^"]+)"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

async function prepareIsolatedCodexHome() {
  const isolatedHome = path.join(PROJECT_ROOT, "codex-home");
  await mkdir(isolatedHome, { recursive: true });
  const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  for (const name of [
    "config.toml",
    "auth.json",
    "cc-switch-model-catalog.json",
    "models_cache.json",
  ]) {
    const source = path.join(sourceHome, name);
    const target = path.join(isolatedHome, name);
    try {
      await copyFile(source, target);
    } catch {
      // Missing optional files are fine.
    }
  }
  return isolatedHome;
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(CDP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`CDP list failed with ${response.status}`);
  }
  return response.json();
}

async function injectRenderer(target) {
  const appLanguage = await resolveAppLanguage();
  const source = (await readFile(path.join(MODULE_DIR, "renderer.js"), "utf8"))
    .replace(
      'const APP_LANGUAGE = "__APP_LANGUAGE__";',
      `const APP_LANGUAGE = ${JSON.stringify(appLanguage || "")};`,
    );
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await openWebSocket(ws);

  try {
    await sendCdp(ws, "Page.enable");
    await sendCdp(ws, "Page.addScriptToEvaluateOnNewDocument", { source });
    const evaluation = await sendCdp(ws, "Runtime.evaluate", {
      expression: source,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluation.exceptionDetails) {
      const detail = evaluation.exceptionDetails.exception?.description
        || evaluation.exceptionDetails.text
        || "Unknown renderer injection error";
      throw new Error(detail);
    }
  } finally {
    ws.close();
  }
}

function openWebSocket(ws, timeoutMs = CDP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // Ignore close errors.
      }
      reject(new Error("CDP WebSocket open timed out"));
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not open CDP WebSocket"));
    };
  });
}

async function evaluateOnTarget(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await openWebSocket(ws);
  try {
    const result = await sendCdp(ws, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "Renderer evaluation error";
      throw new Error(detail);
    }
    return result.result?.value;
  } finally {
    ws.close();
  }
}

async function sendCdp(ws, method, params = {}) {
  const pending = new Map();
  let nextId = 1;
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      return;
    }
    const handlers = pending.get(message.id);
    if (!handlers) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      handlers.reject(new Error(message.error.message || "CDP error"));
    } else {
      handlers.resolve(message.result);
    }
  };

  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => {
      pending.delete(id);
      try {
        ws.close();
      } catch {
        // Ignore close errors.
      }
      reject(new Error(`CDP command timed out: ${method}`));
    }, CDP_TIMEOUT_MS);
    const originalResolve = resolve;
    const originalReject = reject;
    pending.get(id).resolve = (value) => {
      clearTimeout(timer);
      originalResolve(value);
    };
    pending.get(id).reject = (error) => {
      clearTimeout(timer);
      originalReject(error);
    };
  });
}

async function processPendingRequests(target) {
  const pending = await evaluateOnTarget(
    target,
    `(() => {
      const bridge = window.__codexSelectionExplainerBridge;
      if (!bridge || !Array.isArray(bridge.pending)) return [];
      const items = bridge.pending;
      bridge.pending = [];
      return items.map((item) => ({ id: item.id, request: item.request }));
    })()`,
  );

  for (const item of pending || []) {
    try {
      const text = await explainStreaming(item.request, (delta) => {
        pushStreamDelta(target, item.id, delta).catch(() => {});
      });
      await resolveRendererRequest(target, item.id, { ok: true, text });
    } catch (error) {
      try {
        await resolveRendererRequest(target, item.id, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (resolveError) {
        try {
          await requeueRendererRequest(target, item);
        } catch {
          // The renderer-side timeout will surface if we cannot recover.
        }
        throw resolveError;
      }
    }
  }
}

async function requeueRendererRequest(target, item) {
  await evaluateOnTarget(
    target,
    `(() => {
      const bridge = window.__codexSelectionExplainerBridge;
      if (!bridge || !Array.isArray(bridge.pending)) return false;
      bridge.pending.push({ id: ${Number(item.id)}, request: ${JSON.stringify(item.request)} });
      return true;
    })()`,
  );
}

async function pushStreamDelta(target, id, delta) {
  await evaluateOnTarget(
    target,
    `(() => {
      const bridge = window.__codexSelectionExplainerBridge;
      if (!bridge) return false;
      bridge.append(${Number(id)}, ${JSON.stringify(delta)});
      return true;
    })()`,
  );
}

async function resolveRendererRequest(target, id, payload) {
  await evaluateOnTarget(
    target,
    `(() => {
      const bridge = window.__codexSelectionExplainerBridge;
      if (!bridge) return false;
      bridge.resolve(${Number(id)}, ${JSON.stringify(payload)});
      return true;
    })()`,
  );
}

async function explain(request) {
  return runCodex(buildExplanationPrompt(request));
}

async function explainStreaming(request, onDelta) {
  const timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);
  return runCodexStreaming(buildExplanationPrompt(request), onDelta, timeoutMs);
}

function buildExplanationPrompt(request) {
  const selection = String(request?.selection || "").trim();
  if (!selection) {
    throw new Error("No selected text was provided");
  }
  const context = request?.context && typeof request.context === "object"
    ? request.context
    : {};
  const question = String(request?.question || "这是什么").trim() || "这是什么";
  const outputLanguage = String(request?.outputLanguage || "input").trim() || "input";
  const uiLanguage = String(context.appLanguage || "zh-CN").trim() || "zh-CN";
  const conversation = limitText(context.conversation, 12000);
  const nearby = limitText(context.nearby, 6000);
  const languageInstruction = outputLanguage === "input"
    ? `与划选文字的语言保持一致；如果划选文字是代码、标识符或没有明显自然语言，则使用当前界面语言 ${uiLanguage} 回答`
    : `使用 ${outputLanguage} 回答`;
  const prompt = [
    "你是 Codex 桌面端的划词解释助手。",
    "回答要求：",
    `- 回答语言：${languageInstruction}`,
    "- 必须结合当前 Codex 对话上下文和选区附近文本来理解划选文字，不要孤立解释这个词本身。",
    "- 解释要落到当前对话正在讨论的任务、代码、问题或主题中。",
    "- 先给出结论，再用 2 到 4 句简短说明。",
    "- 如果语境不完整，明确说明哪些部分是推测。",
    "- 不要执行工具，不要读取或修改用户文件。",
    "- 回答控制在 250 字以内。",
    "",
    `用户问题：${question}`,
    "",
    "划选文字：",
    "<<<SELECTED_TEXT",
    selection,
    "SELECTED_TEXT>>>",
    "",
    "当前 Codex 对话上下文（已压缩）：",
    "<<<CONVERSATION_CONTEXT",
    conversation || "未提供",
    "CONVERSATION_CONTEXT>>>",
    "",
    "划选文字附近上下文：",
    "<<<NEARBY_CONTEXT",
    nearby || "未提供",
    "NEARBY_CONTEXT>>>",
    "",
    "页面上下文：",
    `标题：${context.title || "未提供"}`,
    `URL：${context.url || "未提供"}`,
    `元素：${context.selectedElement || "未提供"}`,
  ].join("\n");

  return prompt;
}

function limitText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  const head = Math.floor(maxLength * 0.7);
  const tail = Math.max(120, maxLength - head - 24);
  return `${text.slice(0, head).trimEnd()}\n...[上下文过长，已压缩]...\n${text.slice(-tail).trimStart()}`;
}

async function runCodex(prompt) {
  const codexPath = config.codexPath || process.env.CODEX_CLI_PATH || "codex";
  const workspaceDir = config.workspaceDir || DEFAULT_WORKSPACE;
  const timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const model = config.model || "";
  await mkdir(workspaceDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-selection-explainer-"));
  const outputPath = path.join(tempDir, "last-message.txt");

  const args = [
    "exec",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--json",
    "-o",
    outputPath,
    "-C",
    workspaceDir,
  ];
  if (model) {
    args.push("-m", model);
  }
  args.push("--", prompt);

  try {
    const { stdout } = await spawnCodex(codexPath, args, prompt, timeoutMs);
    let text = "";
    try {
      text = (await readFile(outputPath, "utf8")).trim();
    } catch {
      text = "";
    }
    if (!text) {
      text = parseLastMessage(stdout);
    }
    if (!text) {
      throw new Error("Codex completed without a final response");
    }
    return text;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCodexStreaming(prompt, onDelta, timeoutMs) {
  return new Promise((resolve, reject) => {
    const codexPath = config.codexPath || process.env.CODEX_CLI_PATH || "codex";
    const workspaceDir = config.workspaceDir || DEFAULT_WORKSPACE;
    const model = config.model || "";
    let child = null;
    let settled = false;
    let fullText = "";
    let buffer = "";
    const pending = new Map();
    let nextId = 1;

    const cleanup = () => {
      try {
        child?.kill("SIGTERM");
      } catch {
        // Ignore kill errors.
      }
      setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch {
          // Ignore kill errors.
        }
      }, 1500).unref();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Codex timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const request = (method, params = {}) =>
      new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });

    const processLine = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          handler.reject(new Error(message.error.message || "Codex request failed"));
        } else {
          handler.resolve(message.result);
        }
        return;
      }
      if (!message.method) {
        return;
      }
      switch (message.method) {
        case "item/agentMessage/delta":
          if (typeof message.params?.delta === "string") {
            fullText += message.params.delta;
            try {
              onDelta?.(message.params.delta);
            } catch {
              // A UI push failure should not kill the model stream.
            }
          }
          break;
        case "item/completed":
          if (
            message.params?.item?.type === "agentMessage" &&
            typeof message.params.item.text === "string"
          ) {
            fullText = message.params.item.text;
          }
          break;
        case "turn/completed":
          if (message.params?.turn?.status === "completed") {
            finish(fullText);
          } else if (message.params?.turn?.status === "failed") {
            fail(new Error(message.params.turn.error?.message || "Codex turn failed"));
          }
          break;
        case "turn/failed":
          fail(new Error(message.params?.error?.message || "Codex turn failed"));
          break;
        case "error":
          fail(new Error(message.params?.message || "Codex app-server error"));
          break;
      }
    };

    (async () => {
      try {
        await mkdir(workspaceDir, { recursive: true });
        const isolatedCodexHome = await prepareIsolatedCodexHome();
        child = spawn(codexPath, ["app-server", "--stdio"], {
          env: { ...process.env, CODEX_HOME: isolatedCodexHome, NO_COLOR: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            if (line.trim()) {
              processLine(line);
            }
          }
        });
        child.stderr.on("data", () => {});
        child.on("error", fail);
        child.on("close", (code) => {
          if (!settled) {
            fail(new Error(`Codex app-server exited with code ${code}`));
          }
        });

        await request("initialize", {
          clientInfo: { name: "codex-selection-explainer", version: "1.0" },
        });
        const threadResponse = await request("thread/start", {
          cwd: workspaceDir,
          ephemeral: true,
          sandbox: "read-only",
          approvalPolicy: "never",
          model: model || undefined,
        });
        const threadId = threadResponse?.thread?.id;
        if (!threadId) {
          throw new Error("Codex did not return a thread id");
        }
        await request("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
          approvalPolicy: "never",
          sandboxPolicy: { type: "readOnly" },
          cwd: workspaceDir,
          model: model || undefined,
        });
      } catch (error) {
        fail(error);
      }
    })();
  });
}

function spawnCodex(command, args, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      reject(new Error(`Codex timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `Codex failed with exit code ${code}: ${(stderr.trim() || stdout.trim() || `signal ${signal || "unknown"}`)}`,
      ));
    });
    child.stdin.end(prompt);
  });
}

function parseLastMessage(stdout) {
  let text = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (
        event?.type === "item.completed" &&
        event?.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        text = event.item.text.trim();
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return text;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown() {
  if (PID_FILE) {
    rm(PID_FILE, { force: true }).catch(() => {});
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
