# Claude Status Monitor for Windows

Windows system tray app + statusline script，監控每個 Claude Code session 的記憶體用量。

## Architecture

```
monitor/app.js (Node.js)          statusline/statusline.sh (Bash)
├─ System tray icon (systray2)    ├─ Claude Code 每次回覆後執行
├─ HTTP API :19823                ├─ /dev/tcp 打 API (~46ms)
├─ 背景每 5s 收集 wmic 資料       ├─ 動態組裝 + ANSI 顏色 + 自動折行
└─ Config: ~/.claude-monitor/     └─ 雙層快取 (PID + mem)
```

## Critical Constraints

- **Statusline 有 500ms timeout** — 超時就不顯示
- **Windows process spawn 很貴** — wmic ~300ms, curl ~650ms, cat ~230ms
- **statusline.sh 裡禁止用 curl** — 用 `/dev/tcp` 代替
- **盡量不 spawn 外部進程** — 用 bash regex 取代 sed/grep
- **`tput cols` 在 pipe 裡永遠回 80** — 寬度靠 monitor 的 Win32 API 偵測
- **systray2 用 `update-item` 不要用 `update-menu`** — update-menu 會讓 onClick 壞掉

## Adding a New Display Item

1. `monitor/app.js` — ITEMS array 加一行（tray 選單自動出現）
2. `statusline/statusline.sh` — 加 regex parse + `if has xxx; then add_item ...` render
3. 沒了。其他檔案不用改。

## Key Commands

```bash
# 啟動 monitor
cd monitor && node app.js

# 測試 API
curl http://127.0.0.1:19823/status/PID

# 測試 statusline（模擬 Claude Code 輸入）
echo '{"session_id":"test",...}' | bash statusline/statusline.sh

# 截取 Claude Code 實際送的 JSON（暫時改 settings.json 指向 capture script）
```

## Statusline JSON 可用欄位

已使用和未使用的欄位見 README。要看實際 JSON 結構，執行上面的截取方法或讀 `/tmp/sl-last-input.json`（如果之前截取過）。

---

## Rules（協作模式規範）

本專案除了是工具，也是「多 session 發包協作模式」的基礎設施。協作規則沉澱在：

- [`docs/rules/multi-session-dispatch.md`](docs/rules/multi-session-dispatch.md) — 多 session 發包協作（Type 1 / Type 2 topic、4 段回報格式、Race 處理、全新使用者落地流程）

這份 rules **跨專案通用**。使用 Minitor 的其他專案可在自己的 CLAUDE.md 引用此文件，專案內文件只寫「具體落地細節」（必讀 guide 清單、業務規範等）。
