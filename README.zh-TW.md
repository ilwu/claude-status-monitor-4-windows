[English](README.md) | **繁體中文**

# Claude Status Monitor for Windows

一個給 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on Windows 的系統工具列小程式，提供兩組實用工具 — 一旦你開始同時跑多個 session，就會需要：

- **Statusline 記憶體監控** — 每個 Claude Code session 的狀態列顯示它自己吃了多少記憶體，一眼就能認出哪個 `claude.exe` 該關。Windows 專屬。
- **本地 Memory API + `mmsg` CLI** — 讓 session 能撐過 context 壓縮，多 session 靠短短一個 `topic-id` 協作而不是複製貼上長對話。跨平台。

![screenshot](screenshots/social-preview.png)

---

## Part 1 — Statusline 記憶體監控

### 問題

你同時開了 3-4 個 Claude Code session，系統越來越慢。打開工作管理員 — 全部都叫 `claude.exe`，根本分不出誰吃了多少記憶體。

### 解法

```
Claude 812M/1.5G (session/total)
       ↑              ↑
   這個 session    全部 session
```

**這是核心功能。** 每個 Claude Code session 的狀態列直接顯示「這個 session 吃了多少 / 全部共多少」。看到哪個特別大？關掉它。問題解決。

其他項目 — 系統記憶體 %、Context 用量、本週用量、模型名稱、花費 — 都是額外資訊，可以從系統工具列自由開關。

### 為什麼需要獨立小工具？直接寫在 shell script 不行嗎？

好問題。我們一開始就是這樣做的，然後踩了一堆坑。

**Claude Code 的 statusline 有 ~500ms 的超時限制。** 腳本跑不完就什麼都不顯示。

在 Windows 上，每次啟動進程都很貴：

| 操作 | 耗時 |
|------|------|
| `wmic` 查詢（1 次） | ~150-300ms |
| `curl` 打 localhost | ~650ms（進程啟動開銷） |
| `cat` 透過 pipe | ~230ms |
| `bash` 啟動 + pipe | ~250ms |

要在 statusline 顯示 per-session 記憶體，腳本需要：

1. 走 parent process chain 找到這個 session 的 `claude.exe` — **多次 `wmic` 呼叫，每次 ~300ms**
2. 查詢該進程的記憶體 — **又一次 `wmic`，~150ms**
3. 查詢系統記憶體 — **再一次 `wmic`，~150ms**

**加起來輕鬆 1-2 秒，遠超 500ms 限制。**

#### 我們的解法：拆分工作

| | 重活（背景執行） | Statusline（快速路徑） |
|---|---|---|
| **誰** | 工具列小程式 (Node.js) | Bash 腳本 |
| **何時** | 每 5 秒 | 每次 assistant 回覆 |
| **做什麼** | `wmic` 查詢所有 session | `/dev/tcp` 打 localhost |
| **耗時** | ~300ms（不影響） | **~60ms**（遠低於 500ms） |

小工具在背景做耗時的 `wmic` 查詢並快取結果。Statusline 只需透過 `/dev/tcp`（不啟動 `curl` 進程）讀取快取資料。首次呼叫會快取 PID，之後每次只要 ~60ms。statusline bash script 本身**零 runtime 依賴** — 不需 curl、不需 jq。

**額外好處：** 小工具提供可見進程（不是幽靈進程）、右鍵選單可切換顯示項目、乾淨的啟動/停止方式。

> **macOS/Linux 上**不需要這種拆分 — 進程查詢很快，statusline 腳本自己就能搞定。Part 1 是針對 Windows 特有問題的 Windows 專屬解。Part 2 才是跨平台價值所在。

### Statusline 項目

| 項目 | 說明 | 預設 |
|------|------|------|
| System Memory | 系統記憶體使用率 % + 進度條 | 開 |
| Claude Memory | 本 session / 全部 session 總計 | 開 |
| MCP Memory | MCP server 進程總用量 + 個數 | 開 |
| Context Window | Context 使用率 % + 進度條 | 開 |
| Weekly Usage | 7 天 API 用量 % + 進度條 | 開 |
| Session ID | 完整 UUID，可用於恢復 session | 開 |
| Project Path | 專案根目錄 | 開 |
| Model Name | 目前使用的模型（如 Opus 4.6） | 關 |
| Session Cost | 累計花費（美金） | 關 |
| Lines +/- | 本 session 新增 / 刪除行數 | 關 |
| Session Duration | 會話已進行時間 | 關 |

從工具列圖示切換項目 — 即時生效，不用重啟。

---

## Part 2 — Memory API + `mmsg` CLI

### 問題

你跟一個 Claude Code session 配對工作好幾個小時。Context 快滿了 → 壓縮 → Claude 「忘了」你整個下午做過的一半決策。或是 session 直接崩掉。或者你同時跑兩個 session — 一個主線、一個發包 — 要它們協作，結果只能在兩個終端視窗之間不斷複製貼上長對話。

Claude Code 自己的 `.jsonl` 記錄檔保留了原始對話，但重讀幾 MB 不等於恢復「work memory」，`--resume` 也不總是夠。

### 解法

tray app 在 `/api/*` 提供一個小型本地 HTTP API，配合零依賴的 `mmsg` CLI。資料存 repo 下的 SQLite 檔（`data/memory.db`，WAL mode，已 gitignore）。

**Session 撐過崩潰 / 壓縮：**

```bash
# 壓縮前主 session 寫結構化 snapshot
mmsg snapshot <<'EOF'
{ "current_task": "refactor commission wallet",
  "next_steps": ["跑 e2e", "更新 CHECKLIST.md"],
  "blockers": [],
  "modified_files": ["src/modules/.../wallet.ts"] }
EOF

# session 死了 / 被壓縮。新 session 一個指令接手：
mmsg recovery
# → Markdown 報告：snapshot + 最近 10 個 user prompt + 最近 20 筆檔案異動
#   5 秒讀完，而不是拆 10MB 原始 .jsonl
```

**兩個 session 靠一個短 id 協作：**

```bash
# 主 session
TOPIC=$(echo "TODO-19 拔除計畫" | mmsg topic-new --title="TODO-19" --author=main)
echo $TOPIC   # → t-a7b3f9c2  — 把這一組 id 貼給另一個 session

# 另一 session 讀並回覆
mmsg topic-show t-a7b3f9c2
echo "已收到 — 正在審查 X" | mmsg topic-add t-a7b3f9c2 --author=worker

# 主 session 回看
mmsg topic-show t-a7b3f9c2
```

不用 lock-step 共改檔案。不用複製貼上大段 prompt。只是一個 8 字元的 id。

### 跨平台

Memory API、`mmsg` CLI、UserPromptSubmit hook 只用 Node built-in + 讀 `~/.claude/projects/*.jsonl`，**Windows、macOS、Linux 都可用**。只有 Part 1 的 `/status/*` statusline 監控是 Windows-only（依賴 `wmic`）。

### API 路由

根位置 `http://127.0.0.1:19823/api`，全回 JSON。錯誤統一格式：`{ "error": { "code": "...", "message": "..." } }`。HTTP status code 按慣例（400 / 404 / 413 / 500）。

| Route | 用途 |
|-------|------|
| `GET  /api/health` | DB 連線與 server 健康 |
| `GET  /api/stats` | 各表 row 數 |
| `POST /api/sessions` | Upsert session metadata |
| `GET  /api/sessions` | 列出（最近活動優先） |
| `GET  /api/sessions/current?cwd=<path>` | 依 cwd 反查當前 session_id（讀 `.jsonl`，**不用 wmic**） |
| `GET  /api/sessions/:id` | 明細 |
| `POST /api/sessions/:id/snapshots` | 寫 snapshot（自動 `snapshot_seq`） |
| `GET  /api/sessions/:id/snapshots/latest` | 最新一份，`summary_json` 自動 parse |
| `GET  /api/sessions/:id/snapshots` | 所有 snapshot |
| `GET  /api/sessions/:id/recovery` | 救援 bundle（snapshot + prompts + file_edits） |
| `POST /api/sessions/:id/prompts` | 記 prompt 精華（前 200 字上限） |
| `POST /api/sessions/:id/file-edits` | 記檔案操作 |
| `POST /api/topics` | 建主題。`first_message` 存在時 atomic 建主題 + 首條訊息 |
| `GET  /api/topics` | 列主題。`?status=active&recent=24h&limit=50` |
| `GET  /api/topics/:id` | 完整 thread。選項 `?latest=N` / `?since=<seq>` / `?summary=true` |
| `POST /api/topics/:id/messages` | 新增訊息（自動 `seq`） |
| `POST /api/topics/:id/close` | 標 closed（不刪資料） |

快速 curl 驗證：

```bash
curl http://127.0.0.1:19823/api/health
curl -X POST http://127.0.0.1:19823/api/topics \
     -H 'Content-Type: application/json' \
     -d '{"title":"hello","first_message":"opening line"}'
```

### `mmsg` CLI 參考

零依賴 Node CLI，Windows 用 `bin/mmsg.cmd` 包裝。把 `bin/` 加到 `%PATH%`（或複製 `mmsg.cmd` 到已在 `%PATH%` 的目錄）即可全系統使用。

| 指令 | 用途 |
|------|------|
| `mmsg topic-new --title=<s> [--author=<s>]` | 建主題，stdin 當 `first_message`；**只印 topic id**，shell 好組合：`TOPIC=$(mmsg topic-new --title=x)` |
| `mmsg topic-add <topic-id> [--author=<s>]` | 加訊息（stdin 當 content），印 `ok seq=N` |
| `mmsg topic-show <topic-id> [--latest=N] [--since=<seq>] [--summary]` | 格式化 thread |
| `mmsg topic-list [--status=active] [--recent=24h]` | 表格列表 |
| `mmsg snapshot [--session=<id>] [--at-prompt=<n>]` | 寫 snapshot，stdin 必須是 valid JSON |
| `mmsg recovery [--session=<id>] [--json]` | Markdown recovery（或 `--json`） |
| `mmsg help [command]` | 說明 |

`snapshot` / `recovery` 的 session 識別：`--session=<id>` > `/api/sessions/current?cwd=$PWD` > friendly error（exit 2）。

Exit code：`0` 成功 / `1` API 錯 / `2` 使用錯 / `3` server 連不上。Port 覆寫用 `MINITOR_PORT=<n>`。

### 可選：UserPromptSubmit 提醒 hook

Claude Code 每次使用者送 prompt 前會觸發這個 hook。提醒 hook 每 10 次 user prompt 提醒一次 `mmsg snapshot`（per-session 計數，diff-based — .jsonl 有 gap 或重跑不會誤跳或重複）。**不自動安裝**，要時貼到 `~/.claude/settings.local.json`（或 per-project `.claude/settings.local.json`）：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "",
        "hooks": [
          { "type": "command",
            "command": "node <repo>/tools/session-prompt-reminder.js" }
        ] }
    ]
  }
}
```

計數方式（contributor 須知）：

- Hook 數 `"type":"last-prompt"` 事件次數（每個 user prompt 一筆）。**不**用 `messageCount`（它在 `turn_duration` event 裡，是全部內部訊息累計，一個 turn 可能跳幾十次 — 用 `count % 10 == 0` 會錯過整個窗口）
- Dedup 採 diff：`~/.claude-monitor/reminder-state.json` 記上次提醒 count，僅當 `count - last >= 10` 提醒。這樣 .jsonl 有 gap / 同 prompt 重跑都安全
- Hook 外層 try/catch 雙層，任何錯誤都 exit 0 靜默（絕不 block user prompt）

### 資料與設定

- **DB**：預設 `<repo>/data/memory.db`，用 `MINITOR_DB_PATH` 覆寫，WAL mode，`data/` 已在 `.gitignore`
- **Port**：`19823`，只綁 `127.0.0.1`。CLI 用 `MINITOR_PORT` 覆寫（server 端要改還是得改 `monitor/app.js`）
- **資料最小化**：`prompts.text_preview` 只存前 200 字；file_path 正規化並限制 1024 字；其他 prompt 內容不入 DB

### 編譯需求

Memory API 用 [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)（同步 API）。多數 Windows 10/11 `npm install` 會下 prebuilt binary，不用編譯。少數情境 node-gyp 會嘗試原生編譯，需要：

- Visual Studio 2019+ Build Tools（C++ workload），或
- 舊版 Node 可試 `npm install --global windows-build-tools`

想完全避免編譯，可把依賴換成 [`sqlite3`](https://www.npmjs.com/package/sqlite3)（async），並把 `monitor/db.js` 的 DAO 改 Promise 版。其他不動。

### Smoke 測試

```bash
node monitor/test/smoke-db.js    # DAO + migration + idempotent init
node monitor/test/smoke-api.js   # 所有 /api/* 用 in-process server 測（ephemeral port）
node monitor/test/smoke-cli.js   # mmsg CLI 透過 subprocess 測
node monitor/test/smoke-hook.js  # UserPromptSubmit hook，假 HOME
```

全用臨時目錄 / 隨機 port，不干擾正在跑的 tray app 或實際 DB。

---

## 快速安裝

**前置條件：** Node.js 18+、Git Bash（隨 [Git for Windows](https://git-scm.com/) 安裝）

```powershell
git clone https://github.com/user/claude-status-monitor-4-windows
cd claude-status-monitor-4-windows
.\install.ps1
```

就這樣。安裝程式會：

1. 安裝 npm 依賴（包含 Memory API 要的 `better-sqlite3`）
2. 複製 statusline 腳本到 `~/.claude/`
3. 設定 Claude Code 的 `settings.json`
4. 建立開機啟動捷徑
5. 啟動 tray app
6. 驗證 `/api/health` 並印出 `mmsg` CLI / hook 設定指示

打開 Claude Code session 就能看到底部狀態列。`mmsg` CLI 方面，把 `bin/` 加到 `%PATH%` 或複製 `bin/mmsg.cmd` 到已在 `%PATH%` 的目錄（installer 輸出會指示）。重跑 `install.ps1` 是安全的 — 它會先停掉 19823 上的舊 monitor，更新檔案，再重啟。

## 運作原理

```
┌─ System Tray App (Node.js, 127.0.0.1:19823) ───────────────────────────┐
│                                                                         │
│  工具列圖示（右下角）             背景 wmic 收集器（每 60s）              │
│                                                                         │
│  HTTP server                                                            │
│    /status/*   Windows-only statusline 資料（wmic → in-memory）         │
│    /api/*      跨平台 Memory API（SQLite-backed）                       │
│                                                                         │
│  SQLite  <repo>/data/memory.db  (WAL mode)                              │
│    sessions / prompts / file_edits / snapshots                          │
│    topics / topic_messages                                              │
│                                                                         │
│  Config  ~/.claude-monitor/                                             │
│    config.json          (statusline 顯示項目設定)                       │
│    reminder-state.json  (per-session 上次提醒的 prompt count)           │
└─────────────────────────────────────────────────────────────────────────┘
         ▲ /dev/tcp                ▲ http.request                ▲ fs read
         │ (~60ms)                 │                             │
┌─ Statusline (bash) ──────┐  ┌─ mmsg CLI (Node) ─────────┐  ┌─ Hook (Node) ────────┐
│ 每次 assistant 回覆執行  │  │ 使用者需要時執行         │  │ 每次 user prompt     │
│ 讀快取 memory + 顯示設定 │  │ 打 /api/*                │  │ 送出前執行           │
│ 組裝 ANSI 顏色輸出       │  │ topic-new / topic-add /  │  │ 數 .jsonl 的 last-   │
│                          │  │ topic-show / snapshot /  │  │ prompt 事件，每 10   │
│                          │  │ recovery                 │  │ 次提醒一次           │
└──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘
```

## 設定

### 切換項目

右鍵工具列圖示，勾選/取消勾選項目。即時生效，重啟後設定保留。

### 手動編輯

設定檔位於 `~/.claude-monitor/config.json`：

```json
{
  "sys_mem": true,
  "claude_mem": true,
  "ctx": true,
  "week": true,
  "session_id": true,
  "path": true,
  "model": false,
  "cost": false
}
```

### 連接埠

Tray app 使用 `19823`。如需更改，編輯 `monitor/app.js` 裡的 `PORT` 常數。`mmsg` CLI 接受 `MINITOR_PORT` env 覆寫（測試時好用）。

## 移除

```powershell
.\uninstall.ps1
```

會移除：開機啟動捷徑、statusline 設定、monitor 設定檔。SQLite DB（`data/memory.db`）和專案檔案保留，要刪自行處理。

## 疑難排解

### Statusline

**Statusline 顯示 `?` 或空白**
- 確認 monitor 有在執行（看右下角有沒有橘色圖示）
- 手動啟動：雙擊 `monitor/start.vbs`

**Statusline 顯示 `offline`**
- Monitor API 無法連線。從工具列重啟或雙擊 `start.vbs`

**第一次 statusline 顯示很慢**
- 正常。首次會探索 session 的 PID（約 300ms），之後都走快取（約 60ms）。

**工具列圖示沒出現**
- 可能在溢位區域。點工作列的 `^` 箭頭檢查。

### Memory API / `mmsg` CLI

**`mmsg` 顯示 `Minitor tray app not running`**
- tray app 沒跑。啟動：雙擊 `monitor/start.vbs` 或重跑 `install.ps1`。

**`mmsg` 卡住或 timeout**
- Port 19823 被其他程式佔用。查看：`netstat -ano | findstr 19823`，停掉佔用者。

**UserPromptSubmit 提醒從未出現**
- 確認 hook 真的有設：`cat ~/.claude/settings.local.json`，找 `UserPromptSubmit` 區塊（見上方 hook 章節）。
- 提醒每 10 個 user prompt 觸發一次（per session）。`~/.claude-monitor/reminder-state.json` 刪掉可重置計數器。
- Hook 錯誤一律靜默（設計如此 — 不能 block user prompt）。手動驗證：在有 Claude Code session 的專案目錄跑 `node <repo>/tools/session-prompt-reminder.js`，count 對時會 print 到 stdout。

## 系統需求

- Windows 10/11（statusline monitor 與 tray app 部分）
- Node.js 18+
- Git Bash（Git for Windows）— statusline script 用
- Claude Code CLI
- **可選**：Visual Studio 2019+ Build Tools（C++ workload） — 僅在 `better-sqlite3` 抓不到 prebuilt binary 時才需要（多數環境不會）

## 授權

MIT
