# Codex for Linux Quick Ask Plugin

在 Codex Linux Desktop 中选中文字后快速查看解释的本地插件，当前版本为
`0.1.3`。

## 功能
<img width="226" height="92" alt="image" src="https://github.com/user-attachments/assets/2a358065-aca1-4d01-b736-5fe3fa081deb" />
<img width="577" height="310" alt="image" src="https://github.com/user-attachments/assets/8e7bde87-1a8a-4799-8dc0-c1faec63451d" />

- 选中文字后，在选区旁显示“这是什么”按钮。
- 点击后打开可拖动的解释浮窗。
- 点击页面空白处不会关闭浮窗，只能点击右上角关闭按钮。
- 在解释浮窗内再次选中文字，可以创建新的解释浮窗，旧浮窗保持打开。
- 解释请求携带当前对话上下文和选区附近文本，并在前端实时流式显示。
- 解释中的 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 公式会使用随插件
  分发的 KaTeX 在本地渲染，不依赖外部 CDN；解析失败时保留原始公式文本。
- 界面支持中文、英语、日语、韩语、法语、德语、西班牙语、俄语、
  葡萄牙语和意大利语。
- 输出语言默认跟随选中文字语言；代码、标识符等内容默认使用当前界面语言。
- helper 只监听本机 `127.0.0.1`，通过本机 Codex CLI 的只读临时会话生成解释。

## 环境要求

- Linux
- Codex Desktop Linux 版本，且该版本提供 `.codex-linux` 启动钩子
- 已安装并可运行的 `codex` CLI
- Node.js 18 或更高版本

## 安装

```bash
git clone https://github.com/Winzler-Botawar/Codex-for-Linux-Quick-Ask-Plugin.git
cd Codex-for-Linux-Quick-Ask-Plugin
bash install.sh
```

安装脚本会：

1. 把 helper 安装到 `~/.local/share/codex-selection-explainer/`。
2. 在 Codex Desktop 的 `.codex-linux` 目录写入启动和退出钩子。
3. 开启本地 CDP 调试端点，并在 Codex 启动时自动运行 helper。

安装完成后，完全退出 Codex Desktop，包括托盘进程，再重新打开应用。

如果 `codex` 不在 `PATH` 中，可以指定 CLI 路径：

```bash
CODEX_CLI_PATH=/path/to/codex bash install.sh
```

如果 Codex Desktop 不在默认目录，可以指定应用目录：

```bash
CODEX_DESKTOP_APP_DIR=/path/to/codex-desktop bash install.sh
```

## 验证安装

重新打开 Codex Desktop 后，选中一段文字即可看到“这是什么”按钮。
也可以检查本地 helper：

```bash
curl http://127.0.0.1:34891/health
tail -f ~/.local/share/codex-selection-explainer/helper.log
```

健康检查正常时会返回 JSON，并包含 `"ok": true`。

## 配置

安装后编辑：

`~/.local/share/codex-selection-explainer/config.json`

支持的字段：

- `codexPath`：Codex CLI 的绝对路径。
- `model`：可选，传给后台解释会话的模型名称。
- `timeoutMs`：单次解释超时时间，默认 `120000` 毫秒。
- `workspaceDir`：后台只读临时会话使用的工作目录。

修改配置后，完全退出并重新打开 Codex Desktop。

## 常见问题

### 浮窗按钮不显示

确认 Codex Desktop 已完全退出并重新打开，然后查看：

```bash
tail -n 100 ~/.local/share/codex-selection-explainer/helper.log
```

日志中应出现 `Injected renderer into`。如果没有出现，检查
`CODEX_DESKTOP_APP_DIR` 是否指向包含 `start.sh` 的 Codex Desktop 目录。

### 显示 `Codex app-server error`

先确认 CLI 可用：

```bash
codex --version
```

再检查 helper 日志和认证状态。插件使用本机 Codex CLI 的独立临时会话，
不会修改项目文件；CLI 必须已经完成登录并能正常启动 `codex app-server --stdio`。

### 解释一直显示“解释中”

插件有超时保护。查看日志确认 CLI 是否启动、认证是否有效，以及本机网络是否
可用。必要时可把 `timeoutMs` 调大后重启 Codex Desktop。

## 更新

在仓库目录执行：

```bash
git pull
bash install.sh
```

然后完全退出并重新打开 Codex Desktop。

## 卸载

```bash
bash uninstall.sh
```

同时删除 helper 配置、日志和缓存：

```bash
bash uninstall.sh --purge
```

## 工作原理与隐私边界

Codex Desktop 的公开插件接口目前不直接提供向聊天页面注入浮窗的能力。
本插件使用 Linux 构建提供的本地 Chromium DevTools 端点注入渲染脚本。
解释请求只发送给本机 `codex` CLI；helper HTTP 服务绑定
`127.0.0.1:34891`，不接受外部网络连接。

选中的文字和压缩后的当前页面上下文会提交给本机 Codex CLI，以生成解释。
请不要在选区中包含不应发送给模型的敏感信息。

## 许可证

本项目使用 MIT License，详见 [LICENSE](LICENSE)。

内置的 KaTeX 使用 MIT License，许可证文本位于
[`vendor/katex/LICENSE`](vendor/katex/LICENSE)。
