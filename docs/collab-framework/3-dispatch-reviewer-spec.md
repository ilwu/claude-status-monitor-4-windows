# 3. Dispatch Reviewer Agent 規格（工具層）

> **讀者**：設計 / 實作此 agent 的人；主場景（了解 agent 會檢查什麼、怎麼觸發）
>
> **定位**：發包 / 放行訊息 **前的 sanity check**，強制性來自 PreToolUse hook（**主場景無法跳過**）
>
> **為什麼需要**：主場景憑記憶拼湊 checklist 容易漏（實證過 sys_menu / API 旁路）；hook + agent 把紀律外部化

---

## TL;DR（60 秒讀懂）

1. **Agent 目的**（§A）— 主場景寫完發包 / 放行 draft 後，hook 自動 call agent 驗 checklist；缺項 → block
2. **Input**（§B）— 主場景 draft 訊息 + 上下文（是哪個 Phase 放行 / 新發包）
3. **Output**（§C）— ✅ / 🟡 缺漏 / 🔴 風險 三級結果 + 修正指引
4. **Knowledge base**（§D）— 指向 `1-collaboration-protocol.md` + `2-development-playbook.md`
5. **檢核項**（§E）— 從 §B checklist + §C 交界送 sub + §D 門檻導出
6. **Hook 強制**（§F）— PreToolUse 攔截 `mmsg topic-new/add --author=main-scene`，agent exit 2 → block

---

## §A Agent 定位與目標

### A.1 目的

主場景發包 / 放行訊息**離開鍵盤前**驗一次。不是替代主場景思考，是**防止漏項**。

### A.2 不做的事（明確邊界）

- ❌ **不評技術判斷對錯**（「該用 A 方案還是 B」不是本 agent 職責，屬主場景拍板）
- ❌ **不改主場景 draft**（只提建議，不代寫）
- ❌ **不判斷業務邏輯**（業務對錯屬使用者 / 主場景拍板範圍）
- ❌ **不讀整份 collab-framework**（太重；knowledge base 用關鍵片段）

### A.3 做的事

- ✅ 比對 draft ↔ checklist（§B 發包 10 段 / §C 放行格式 / 驗證問題 / §D 門檻等）
- ✅ 找**結構性漏項**（沒列必讀 / 沒 Phase 拆分 / 沒協調 commit 提醒 等）
- ✅ 找**易漏項**（sys_menu / API 旁路 / i18n / 測試區 TODO 等）
- ✅ 找**格式問題**（topic-id 沒標 / 4 段不齊）

---

## §B Input（Agent 接收什麼）

### B.1 必帶

```yaml
context_type: "發包" | "放行" | "接手確認"
phase: "P0" | "P0.5" | "P1" | ... | "P11"  # 放行時必填
draft_message: <主場景寫的訊息全文>
target_topic_id: "t-xxxxxxxx"
author: "main-scene" | "main-incoming"
```

### B.2 選配（加強檢查精度）

```yaml
task_type: "admin" | "new-module" | "frontend-only" | "business-fix"
previous_phase_report: <sub-session 上則回報，用於確認銜接>
other_active_sessions: [<正在推進的 topic list>]  # commit 協調判斷用
```

---

## §C Output（回報格式）

### C.1 結果分級

| 等級 | 含意 | 對主場景 |
|---|---|---|
| ✅ **通過** | checklist 全涵蓋，可發出 | hook 放行 |
| 🟡 **缺漏** | 有 N 項遺漏，建議補完再發 | hook exit 2 + 列缺項 |
| 🔴 **風險** | 結構性問題（如格式嚴重錯、違反 §1 原則）| hook exit 2 + 示警 + 強制修 |

### C.2 回報結構

```markdown
## Dispatch Reviewer 結果

**等級**: ✅ 通過 / 🟡 缺漏 X 項 / 🔴 風險 Y 項
**context_type**: 發包 / 放行 / 接手
**phase**: P_x

### 缺漏清單（若 🟡）
- [ ] 缺 sys_menu 提醒（Admin 類必帶，§B.5 P7.1）
- [ ] 缺 API 旁路提醒（§B.6 P8.0）
- [ ] 缺驗證問題（§C.1 必含 3-5 題）
...

### 風險清單（若 🔴）
- ⚠ 訊息未標 topic-id（§4 回報格式違規）
- ⚠ Admin 頁面發包未含業務描述（§B.0 第 2 段缺）
...

### 修正指引
- 補第 X 項 → 參考 `2-development-playbook.md §B.0`
- 補第 Y 項 → 參考 `1-collaboration-protocol.md §4.1`

### ✅ 已涵蓋（佐證 agent 真讀了 draft）
- 必讀清單齊（7 份）
- Phase 拆分完整（P1-P11）
- 回報 4 段格式正確
```

### C.3 修正後重 call

主場景補完 → 重發 → hook 再 call → 再驗。一直到 ✅ 才放行。

---

## §D Knowledge Base

### D.1 核心指向

Agent 的 knowledge base 從以下檔**關鍵段落**抽取（不讀整份）：

```yaml
knowledge:
  - path: "1-collaboration-protocol.md"
    sections:
      - "§1.1 角色表（誰能做什麼）"
      - "§1.2 四原則（業務 + UI 上推標準）"
      - "§4.1 4 段回報格式"
      - "§4.3 Sub-session 兩種輸出都標 topic-id"
      - "§6.1 commit 紀律"
      - "§6.3 瀏覽器派 sub-session"
  
  - path: "2-development-playbook.md"
    sections:
      - "§B.0 發包 10 段 checklist"
      - "§B.0.1 必讀 ritual"
      - "§B.0.5 第一輪思考回饋"
      - "§B.5 sys_menu / migration / i18n"
      - "§B.6 P8 API 旁路 + 瀏覽器"
      - "§B.8 P10 commit 協調"
      - "§C.1 放行訊息結構 + 驗證問題"
      - "§C.2.1 各 Phase 驗證問題範例"
      - "§D 判斷門檻 17 條"
      - "§F task→guide 對照表"
```

### D.2 不讀的部分

- Summary 固化細節（§B.9）— 由主場景人工審
- UI 慣例 §E — 候選升級流程，不在 agent 檢核範圍
- §G 源頭聲明 — 純記錄用途

---

## §E 檢核項清單（從 Knowledge Base 導出）

### E.1 發包情境（context_type=發包）

**結構性**：
- [ ] 10 段 prompt 齊（任務 / 業務描述 / 必讀 / 業務規則 / 實作重點 / 範圍 / Phase / 約束 / 測試位置 / 回報要求）
- [ ] 業務描述含 4 子項（為誰 / 解什麼問題 / 業務流程 / 成功指標）
- [ ] 必讀清單走過 §F task→guide 對照
- [ ] 回報要求含「進 P1 前第一輪思考回饋」

**易漏項（按 task_type 判斷）**：
- 若 task_type=admin：
  - [ ] P7.1 sys_menu 提醒
  - [ ] P8.0 API 旁路提醒
  - [ ] 前端 i18n 策略（3 + 9）
- 若涉 entity 新欄位：
  - [ ] P7.2 migration 提醒
- 若涉 e2e 測試：
  - [ ] test-scenarios-guides 在必讀清單
  - [ ] 測試位置明確

### E.2 Phase 放行情境（context_type=放行）

**結構性**：
- [ ] 標題 `# [t-xxx] P_{前} 收 + P_{下} 放行` 格式
- [ ] 「必帶 / 不必帶」兩段清楚
- [ ] 含驗證問題（3-5 題，三層：核心 / 範圍 / 反例）
- [ ] 下一步預告 + 距 commit 距離

**時機門檻（按 phase 判斷）**：
- 若 phase=P3 完成：
  - [ ] 接著放行 P3.5 reviewer 第一輪（§D 門檻必插）
- 若 phase=P6 完成（admin 類）：
  - [ ] 提醒 sys_menu + API 旁路（§D 門檻必提）
- 若 phase=P7 / P8 / P9 完成（距 commit ≤ 2 步）：
  - [ ] 顯眼標「需協調 commit 順序」
- 若 phase=P8 瀏覽器驗：
  - [ ] 派 sub-session 而非主場景自跑

### E.3 格式 / 紀律（通用）

- [ ] 訊息標 topic-id
- [ ] commit 相關 → pathspec 明確 / 不用 `git add .`
- [ ] 跨 repo 或 同 repo 其他 session commit 狀態確認

### E.4 違規（🔴 風險等級）

- [ ] Admin 頁面發包缺業務描述
- [ ] 放行 P8 寫「你自己跑」（應派 sub-session）
- [ ] commit 訊息含廣義 add 指示
- [ ] Sub-session 請示業務 / UI 決策但主場景自拍（未上推）
- [ ] 引用「既有 pattern」作不修 reviewer 的依據（§1.3.1）

### E.5 ctx 預警（通用觸發，跨 context_type）

**主場景 ctx ≥ 90% 時，任何 mmsg 動作都強制插入交接程序**。

理由：
- 主場景 ctx 耗盡才做 summary 已太晚（可能真的爆）
- 預警機制強制在還來得及時觸發
- 靠主場景自覺 = 不可靠（阻力最小路徑會跳過）

Hook 動作：
1. 偵測主場景 ctx ≥ 90%（實作方式見 §F）
2. 輸出告警 + 指向**該專案的交接 SOP**（各專案自備，如 `docs/ai-session-handoff/0-outgoing-handoff.md` 或類似路徑）
3. 主場景必須先完成交接 SOP 再繼續發訊息

**實作 TODO**：
- dispatch-reviewer-hook.sh 目前不取 ctx 使用率
- 需要 Claude Code hook 提供 ctx metadata（或環境變數）
- 若 Claude Code 不支援 → 退回「使用者手動觸發交接」

---

## §F Hook 機制

### F.1 位置

`settings.json`（`~/.claude/settings.json` 或 `.claude/settings.local.json`）

### F.2 PreToolUse Hook 設定

**Claude Code matcher 限制**：matcher 只接受**工具名字串**（如 `"Bash"` / `"Edit|Write"`），**不支援 command 內容 pattern**（不能 `Bash(mmsg:*)` 或物件形式）。

因此實作採「matcher=Bash 全接 + script 內過濾」：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash C:/workspace/tools/dispatch-reviewer-hook.sh"
          }
        ]
      }
    ]
  }
}
```

**成本評估**：
- 非 mmsg 的 Bash（99%）：script 跑 3-5 行 grep → `exit 0`（延遲 < 50ms，感知不到）
- mmsg 符合 pattern（1%）：跑完整驗證

全 Bash 觸發**不是效能問題**，只要 script 內首步過濾快即可。

### F.3 Hook Script 行為

```bash
#!/bin/bash
# dispatch-reviewer-hook.sh

# 1. 從 stdin 讀 tool input（JSON，含 Bash command）
TOOL_INPUT=$(cat)

# 2. 解析出 command 字串
COMMAND=$(echo "$TOOL_INPUT" | grep -oP '"command":\s*"[^"]*"' | ...)

# 3. 第一步過濾：非 mmsg topic-new/add 或非 main-scene author → 立即 exit 0
if ! echo "$COMMAND" | grep -qE 'mmsg(\.cmd)?\s+topic-(new|add)'; then
  exit 0
fi
if ! echo "$COMMAND" | grep -qE -- '--author=main-(scene|incoming)'; then
  exit 0
fi

# 4. Override flag 檢查
[ -n "${MAIN_SCENE_OVERRIDE:-}" ] && exit 0

# 5. 解析訊息檔案路徑（主場景慣例 `cat /path | mmsg ...`）
MSG_FILE=$(echo "$COMMAND" | grep -oP '(?<=cat\s)[^\s|]+' | head -1)
[ -z "$MSG_FILE" ] || [ ! -f "$MSG_FILE" ] && exit 0  # 非檔案 pipe 慣例不攔

# 6. 驗證訊息內容（regex 簡易版 / 或 call agent）
# ... 違規檢查 ...

# 7. 決策：有違規 → stderr 輸出 + exit 2 block
case "$RESULT" in
  "✅"*)
    exit 0  # 放行
    ;;
  "🟡"*|"🔴"*)
    echo "$RESULT" >&2  # stderr 輸出 Claude 會看到
    exit 2  # block
    ;;
esac
```

### F.4 Agent 執行方式

兩選項：
1. **Sub-agent call**（`Agent tool` 內建的 `dispatch-reviewer` type）— 在主 Claude Code session 內 call，用 agent 的 ctx
2. **外部 LLM call**（hook script 直接打 API）— 完全外部化，不吃 session ctx

**建議選 1**（對齊 Claude Code 生態，不用管 API key / quota）。

### F.5 主場景繞不過

- Hook exit 2 → Claude Code 把 feedback（agent output）塞進下一輪 context
- Claude 讀到 feedback → 必須回應缺項 → 修 draft → 重試
- 除非主場景**明知**在做測試（有 flag 繞過）否則無法跳

---

## §G 部署與失效處理

### G.1 初次部署步驟

1. 確認 `1-collaboration-protocol.md` + `2-development-playbook.md` 定稿
2. 建 `.claude/agents/dispatch-reviewer.md`（agent 定義 + knowledge base pointer）
3. 寫 `C:/workspace/tools/dispatch-reviewer-hook.sh`
4. 設 `settings.json` PreToolUse hook
5. 測試：主場景故意寫個漏 sys_menu 的 admin 發包 → 驗 hook 攔截

### G.2 Agent 失靈處理

若 agent call 本身失敗（API 掛 / sub-agent ctx 不足）：
- Hook script exit 0（放行，不阻塞協作）
- stderr 記一則警告
- 主場景自行靠 `2-development-playbook.md` checklist 手動走一遍

**不讓 agent 成為阻塞瓶頸** — 工具失靈退回原本的「靠紀律」狀態。

### G.3 誤攔處理

若 agent 誤標 🔴 / 🟡（主場景確認該訊息沒問題）：
- 主場景加 flag（例 `MAIN_SCENE_OVERRIDE=1`）一次性繞過
- 記錄於 `ref/reviewer-false-positives.md`（累積）
- 使用者觸發整理時評估：是否修 agent knowledge base 減少誤判

### G.4 Knowledge Base 同步

當 `1-collaboration-protocol.md` / `2-development-playbook.md` 更新：
- Knowledge base pointer 不用動（抽取時讀檔）
- 若新增檢核項 → agent 自動涵蓋
- 若刪舊檢核項 → agent 不再抓
- **但 agent 可能 cache**（視實作）→ 重啟 sub-agent / 清 cache 對齊

---

## §H 實作未完項

本規格為**設計**，實作時需補：
- [ ] `.claude/agents/dispatch-reviewer.md` agent 定義檔內容
- [ ] `dispatch-reviewer-hook.sh` script 實作
- [ ] 測試 case（主場景 draft 幾種情境驗 hook 行為）
- [ ] 誤攔 bypass flag 實作
- [ ] 和既有 `git-guard-hook.sh` 的互動驗證（兩 hook 不衝突）

---

## §I 版本

- v0.1 — 2026-04-21 建立規格（§A-G 完整，實作待做）
