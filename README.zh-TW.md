[English](README.md) | **繁體中文**

# Claude Status Monitor for Windows

在 Windows 上監控每個 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session 的記憶體用量。

**系統變慢時，一眼看出該關哪個 session。**

<!-- ![screenshot](screenshots/preview.png) -->

## 問題

在 Windows 上同時開多個 Claude Code session，系統記憶體很快就被吃滿。但你無法分辨哪個 session 是記憶體怪獸 — 只能猜，或打開工作管理員手動比對 PID。

## 解決方案

一個輕量的系統工具列小程式：

- 追蹤**每個 Claude Code session** 的記憶體用量
- 即時資料顯示在 Claude Code 的 **statusline**（底部狀態列）
- 用顏色標示警告，讓你立刻知道哪裡有問題
- 常駐系統工具列 — 不是幽靈進程，右鍵就能退出

```
Sys ▊▊▊▊▊░░░░░ 57% │ Claude 1.0G/1.3G │ Ctx ▊░░░░░░░░░ 13% │ Week ▊▊▊▊▊▊▊▊▊░ 95% │ ...
    ^^^^^ 綠色                                                       ^^^^^ 紅色 = 警告
```

## 功能

- **Per-session 記憶體** — 精確顯示每個 session 的用量
- **系統工具列圖示** — 橘色圓點在右下角，右鍵管理
- **可自訂項目** — 從工具列選單勾選要顯示的項目
- **顏色進度條** — 綠色 (<50%)、黃色 (50-75%)、紅色 (>75%)
- **雙層快取** — PID 快取 + 記憶體快取，狀態列不會漏顯示
- **開機自啟** — 設定一次，永遠待命
- **零外部依賴** — 純 bash statusline，不需要 curl（用 `/dev/tcp`）

### Statusline 項目

| 項目 | 說明 | 預設 |
|------|------|------|
| System Memory | 系統記憶體使用率 % + 進度條 | 開 |
| Claude Memory | 本 session / 全部 session 總計 | 開 |
| Context Window | Context 使用率 % + 進度條 | 開 |
| Weekly Usage | 7 天 API 用量 % + 進度條 | 開 |
| Session ID | 完整 UUID，可用於恢復 session | 開 |
| Project Path | 專案根目錄 | 開 |
| Model Name | 目前使用的模型（如 Opus 4.6） | 關 |
| Session Cost | 累計花費（美金） | 關 |

從工具列圖示切換項目 — 即時生效，不用重啟。

## 快速安裝

**前置條件：** Node.js 18+、Git Bash（隨 [Git for Windows](https://git-scm.com/) 安裝）

```powershell
git clone https://github.com/user/claude-status-monitor-4-windows
cd claude-status-monitor-4-windows
.\install.ps1
```

就這樣。安裝程式會自動：
1. 安裝 npm 依賴
2. 複製 statusline 腳本到 `~/.claude/`
3. 設定 Claude Code 的 `settings.json`
4. 建立開機啟動捷徑
5. 啟動 monitor

打開 Claude Code session 就能看到底部的狀態列。

## 運作原理

```
┌─ 系統工具列小程式 (Node.js) ─────────────────────────┐
│                                                        │
│  工具列圖示（右下角）                                    │
│    右鍵：切換項目、退出                                  │
│                                                        │
│  背景收集器（每 5 秒）                                   │
│    wmic → 全部 claude.exe PID + 記憶體                  │
│    wmic → 系統記憶體 %                                  │
│                                                        │
│  HTTP API (localhost:19823)                             │
│    GET /status/:pid → session 記憶體 + 合計 + 設定      │
│                                                        │
│  設定檔 (~/.claude-monitor/config.json)                  │
│    顯示項目設定，切換即儲存                               │
│                                                        │
└────────────────────────────────────────────────────────┘
         ▲ /dev/tcp (~46ms)
         │
┌─ Statusline (bash) ──────────────────────────────────┐
│  1. PID 快取查詢（或首次 parent chain 探索）            │
│  2. 查詢 API → 取得資料 + 顯示設定                     │
│  3. 依據設定動態組裝顯示項目                             │
│  4. ANSI 顏色輸出                                      │
└──────────────────────────────────────────────────────┘
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

Monitor 使用 localhost 的 `19823` 連接埠。如需更改，編輯 `monitor/app.js` 第 7 行。

## 移除

```powershell
.\uninstall.ps1
```

會移除：開機啟動捷徑、statusline 設定、monitor 設定檔。專案檔案本身保留，可手動刪除。

## 疑難排解

**Statusline 顯示 `?` 或空白**
- 確認 monitor 有在執行（看右下角有沒有橘色圖示）
- 手動啟動：雙擊 `monitor/start.vbs`

**Statusline 顯示 `offline`**
- Monitor API 無法連線。從工具列重啟或雙擊 `start.vbs`

**第一次 statusline 顯示很慢**
- 正常。首次會探索 session 的 PID（約 300ms），之後都走快取（約 60ms）。

**工具列圖示沒出現**
- 可能在溢位區域。點工作列的 `^` 箭頭檢查。

## 系統需求

- Windows 10/11
- Node.js 18+
- Git Bash（Git for Windows）
- Claude Code CLI

## 授權

MIT
