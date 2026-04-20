---
name: multi-session-dispatch
scope: all-projects
status: active
created: 2026-04-20
updated: 2026-04-20
applies-to: [claude-code, mmsg-topic]
summary: Type 1/2 topic patterns, 4-part user-facing report format, race handling, new-user onboarding checklist for multi-session coordination via mmsg.
---

# 多 Session 發包協作模式 — Rules

> Claude Code 主 session 統籌、發任務給多個 sub-session 並行推進、使用者做業務決策的協作模式規範。
> 本 rules 建立在 Minitor（本專案）的基礎設施上（`mmsg` CLI + topic + session 記憶）。

---

## 一、適用場景

### 1.1 本模式適用
- 單人開發 + AI 協作為主力的中大型專案
- 主 session 持續存在做「統籌 + 業務決策收斂」
- sub-session 做執行性工作（開發 / 測試 / 文件 / 驗證）
- 使用者做最終業務拍板
- 並行 2-5 個 sub-session 是常態

### 1.2 和「session 接力交接」不同
- **接力交接**：主 session 因 ctx 滿 / 意外死亡，交棒給下一個主 session（**單一主線延續**）
  → 規則見 `dev-session-handoff.md` / `main-session-handoff.md`（各專案自有）
- **發包協作**（本文）：主 session 存在期間同時指揮多 sub-session（**一對多同步**）

兩者可以並存（主 session 交接時把「當前進行中的發包 topic 清單」也交接給下一主）。

---

## 二、Topic 兩 Type

Minitor 的 mmsg topic 分兩類用途：

### Type 1 — Session 記憶型

- **一 session 一 topic**（獨占）
- **subject**：session 的用途 / 當前主題（e.g. `主線推進 2026-04-20` / `信用點設計討論`）
- metadata：
  - `session_id`（Claude Code session id）
  - `session_name`（使用者指定的辨識名）
  - `type=1`
- 內容：
  - 自動記錄每個 UserPromptSubmit / Stop / PostToolUse（走 hook）
  - 每 10 輪對話觸發 LLM summary + 更新「交接 prompt」欄位
  - 使用者可隨時 `mmsg topic-show` 看完整記憶
- 生命週期：session 結束即停更，保留供未來回查 / 接力

### Type 2 — 派工型

- **subject**：任務名稱（e.g. `admin-2614 廳主錢包操作發包` / `credit-point 信用點模組發包`）
- 多 `author` 協作（例：`main` / `2614-session`）
- metadata：
  - `type=2`
  - `derived_from`（可選，Type 1 topic id — 標明本派工源於哪個 Type 1 的討論）
- 階段性回報 + 放行 + 決策 Q&A
- 生命週期：任務完成 → 封存（保留歷史供查詢）

### 跨 Type 關聯
討論在 Type 1 → 結論發包成 Type 2。Type 2 metadata 的 `derived_from` 指回 Type 1，未來回查「這任務的設計理由」可一路追。

---

## 三、角色與責任邊界

```
使用者（業主）
  │ 業務方向 / 最終拍板 / 戰略取捨
  ↓
主 session（統籌）
  │ 需求梳理 / 設計文件 / 發包 / 階段審核 / 整合報告
  ↓
sub-session（執行）
  │ 實作 / 測試 / 回報 / 遇業務決策停
```

| 角色 | 做 | 不做 |
|------|----|------|
| 使用者 | 業務決策、方向指引、驗收 | 技術細節微調、tsc 錯誤排查 |
| 主 session | 統籌、發包 prompt、review 回報、階段整合、**拍板前對照實作 + 當前前提** | 最終業務拍板、大規模重構 |
| sub-session | 執行 Phase、測試、回報、遇阻請示 | 業務決策、擴大範圍、破壞性 git |

### 3.1 主 session 拍板三原則

**原則 1：拍板技術決策前先對照實作**

不能只看設計文件就改規則 / 邊界值 / validation 門檻。設計文件可能滯後、描述方式與實作不同。實作才是真相。

流程：遇 sub-session 請示技術決策 → `grep` 實作 / 讀對應 facade / service → 對照設計文件差異 → 拍板。

**反例**：設計寫「X > 1」以為是筆誤改「X >= 1」，但沒查實作 facade 內部有 `X <= 1 throw` → 拍板後 sub-session 跑測試才發現邊界不符。

**原則 2：拍板前對照當前專案前提**

業務決策前必須記清**當前專案的約束**：
- 時程壓力（幾週內上線？）
- 系統現況（未上線 / 正式運行 / 過渡期）
- 使用者明示的邊界（「舊系統不用」/「不考慮相容」）
- 已決的大方向（不要走回頭路）

**反例**：主 session 拍「中期 1-2 月做某整合」但忘了使用者明說「兩週內上線」 → 方向錯需撤回。

**原則 3：業務決策上推**

技術決策自己拍 + Q&A 給使用者看（讓他有機會 override）。業務 / 戰略決策**必停**上推使用者：
- 新功能範圍 / 業務規則語意
- 向後相容 vs 激進切換
- 優先級 / 時程調整
- 有多個可行選項且選項間業務意義不同時

### 3.2 Sub-session 自主判斷 3 類

Sub-session 遇問題時判斷層級：

| 類別 | 描述 | 行動 |
|------|------|------|
| ✅ **純實作** | tsc 錯、路徑錯、命名對齊、未用 import、1-2 行 typo、小重構（如注入簡化）、本地技術判斷（直接查 table vs 走 facade 等效）| **自己拍**，回報時提一行「順手修 X」 |
| 🟡 **跨層 / 跨模組** | 改 facade DTO 簽名、新加 enum 值、跨模組 import 關係變化、影響測試 fixture | **回報主 session 確認**，不自動推進 |
| 🔴 **業務決策** | 流程異動、欄位語意、範圍擴大、和設計規範衝突、實作發現設計矛盾 | **必停** + `mmsg topic-add` 請示 + 等放行 |

**判斷依據**：改動若只影響「本模組本次任務」→ ✅；若影響其他模組 / 未來維護 → 🟡；若涉及業務行為 → 🔴。

**反例**：sub-session 看似「小整合」其實是「業務切換」（如 Deposit 的 A1/A2/A3 切換）→ 誤判 🟡 / ✅ 就擴大範圍了。遇不確定直接升級 🔴 停等，比事後回退便宜。

**最重要的邊界**：sub-session 遇**業務決策**必須停，不自推進。

---

## 四、主 session 對使用者的回報格式（強制 4 段）

```markdown
## [topic: t-xxxxxxxx | session 名] Phase X

**執行**：✅ / 🟡 部分 / ❌ 阻塞（一句話）

**摘要**：session 做了什麼、驗收數字（tsc / 測試 / build）、關鍵判斷

**Q&A**（session 請示 / 主 session 拍板）：
- Q: ...
- A: ...

**⚠ 需你決策**：
- [ ] 項目 1（附選項 + 我的建議）
- 或 "無，繼續推"
```

### 原則
- **永遠標 topic id**（使用者不用翻找）
- **永遠寫「需你決策」段**（即使沒有也寫「無」，避免使用者猜）
- **不跳過 Q&A**（即使都是主 session 自己拍的技術決策，也要列讓使用者有機會 override）
- **摘要含驗收數字**（tsc 0 / X 測試綠 / 不要用「全過」帶過）

### 反例
```
放行 2614 P3（seq=9）+ @CentsField 小修。
```
**問題**：沒 topic id 好找、沒說哪個 session、沒 Q&A 過程、沒決策點標記。

### 正確
```
## [t-9fa6be09 | 2614-session] P3 Controller + Module

**執行**：✅
**摘要**：DTO 補 @CentsField 對齊元/分、Controller 4 endpoint、Module 11 個 imports 含 NgrRevenueShareModule、AdminModule 註冊、tsc 0
**Q&A**：
- Q: minPendingRelease 是元還是分？
- A: 加 @CentsField → 前端傳元、service 自動收分
**⚠ 需你決策**：無
```

---

## 五、Sub-session 回報格式（強制）

Sub-session 有**兩種輸出**，**都要帶 topic id**：

### 5.1 mmsg topic-add 訊息（跨 session 傳遞）

```markdown
# [t-xxxxxxxx] P? 狀態 — 1 句摘要

（接正文，照發包 prompt 指定的結構）
```

必要元素：
- 標題行：`# [topic-id] P? 完成/中途請示 — 摘要`
- 改動檔案清單（後端 / 前端分列）
- 驗收數字（tsc / 測試 / build）
- 偏離設計文件（有則說明，沒有寫「無」）
- 下一步預告

### 5.2 Sub-session 對「自己 Claude 介面」的階段回報輸出（新，2026-04-20）

Sub-session 在自己 Claude Code 對話介面輸出「階段回報」文字時（給使用者看的 `●` 符號那條訊息），**也要帶 topic id**。

**原因**：使用者看 sub-session 自己介面，若要把回報轉貼給主 session，介面文字沒 topic id 就無法快速定位。

**格式**（擇一）：

```
● [t-xxxxxxxx] P? 完成：摘要
```

或：

```
● P? 完成（t-xxxxxxxx seq=N）：摘要
```

**反例**：

```
● P3 完成（seq=8）：Controller + Module + AdminModule 註冊 + tsc 0。
```

**問題**：seq=8 給了但沒 topic id，使用者要翻找是哪個 topic。

**正確**：

```
● [t-7ebdd5ab] P3 完成：Controller + Module + AdminModule 註冊 + tsc 0。
```

### 5.3 觸發時機（對自己 Claude 介面）

Sub-session 在以下時機對自己介面輸出都要帶 topic id：
- Phase 完成宣告
- 中途請示
- 錯誤 / 警告回報
- 發送 mmsg topic-add 前後的「我做了什麼」總結

不需要標的：
- 執行單一 tool 的中間輸出（Read / Grep 結果）
- 思考 / 規劃過程
- 不涉及「使用者轉貼」的細節對話

---

## 六、Race 處理（sub-session）

Sub-session **不可**「回報 A 階段 + 立刻推進 B 階段」。

**規則**：
1. 回報 = 等放行（等 main author 的 ack）
2. 等放行期間可以做**不會產生決策分歧的準備動作**（讀文件、規劃下一步）
3. 不可以**動程式碼 / 動檔案 / 動測試**（避免放行者糾正時要回退）

**例外**：發包 prompt 明確授權「無阻塞直接推進」（例：Phase 1-3 全部自動 ack）。

---

## 七、發包 prompt 核心組成

對照主 session 使用的發包 prompt 模板，**每份發包必含**：

1. 必讀文件（按順序）
2. 關鍵業務理解（5-10 條摘要）
3. 關鍵實作點（3-8 條）
4. 範圍邊界（做 / 不做）
5. Phase 拆分 + 回報節奏
6. 執行約束（tsc 0 / 不啟 server / commit 略 .md / 破壞性 git hook）
7. 測試位置
8. i18n 策略（若涉前端）
9. 回報要求（**強制標 topic id 的回報格式**）

各專案可在自己的開發規範裡延伸模板（e.g. Platform-BackendServer 的 `docs/guides/principles/ai-collaboration/dev-session-handoff.md`），但「回報標 topic id」這條跨專案通用。

---

## 七之一、不估時程（2026-04-20 新增）

**原則**：主 session 不替 sub-session 估完成時間。

理由：
- AI session 執行速度遠超人類工程師，「中型 2-3 天」類描述以人類為基準 — 不準
- 主 session 估時程消耗 ctx，對推進無益
- 實際完成時間由 session 回報的 tsc / 測試 / reviewer 結果決定，不靠事前估

**做法**：
- 發包 prompt **不寫**「中型任務 ~X 天」
- 主 session 回覆不寫「預計 X 天」
- Phase 拆分仍保留（是節奏控制工具）但不標時程
- session 回報完成 = 進下一階段，不看「是否太早」

推進節奏：session 回報 → 決策 → 放行 / 發包 → 繼續。

---

## 七之二、品質檢查兩輪時機（強制）

Sub-session 做完不代表做對。兩輪 code-reviewer **不要擠到 commit 前**，各有不同焦點：

| 輪 | 何時觸發 | Focus | 必帶文件 |
|---|---------|------|---------|
| **第一輪** | **主程序 Phase 完成**（service / controller / 前端主元件 tsc 0），**測試寫之前** | 程式 bug / 命名 / 效能 / CHECKLIST 對照 / 未用 import / 型別漏洞 | 專案 coding-guidelines + CHECKLIST |
| **第二輪** | **測試全綠 + 前端 + i18n 完成**，commit 前 | 整合細節 / 跨模組互動 / 邊界情況 / 前後端對齊 | — |

### 插入規則

- 主程序類 Phase（Service / Controller / 前端主 Component）完成後，**必進第一輪** reviewer 再往下
- 測試類 Phase（寫 e2e / 跑 regression）**不插**（測試本身是檢查）
- i18n Phase **不插**
- 前端主 component 完成時也可**選插**（Phase 6.5 前端品質檢查）

### 為什麼早做第一輪

主程序 bug 在測試寫之前抓到 → 測試不用跟著改。若等測試全綠才做 reviewer，發現主程序 bug 時要**同時回改測試 + 程式**，成本高。

### 實證（2026-04-20）

admin-2614 session 在 P4/P5 測試 26/26 + regression 22/22 全綠後，使用者主動請 session 跑品質檢查，發現要修的不少 — 證明「測試綠 ≠ 程式好」。

從此規則強制：第一輪 reviewer 提到**主程序完成立即做**，不等測試寫完。

### Phase 範本

```
P1 DTO → tsc
P2 Service → tsc
P3 Controller + Module → tsc
P3.5 ★ 主程序品質檢查（code-reviewer 第一輪）
P4 測試基礎場景
P5 批次測試
P6 前端
P6.5 ★ 前端品質檢查（可選）
P7 i18n
P7.5 使用者瀏覽器驗證
P8 code-reviewer 第二輪（整合）
P9 commit
```

---

## 八、常見坑（推演 + 實證）

### 8.1 使用者在狀況外
- 症狀：使用者收到「放行 X」但不知道 Q&A 脈絡
- 根因：主 session 跳過 §四的 Q&A + 決策段
- 對策：強制 4 段格式

### 8.2 交接丟失
- 症狀：session 死亡後接手無法還原
- 根因：沒寫 snapshot / 沒 Type 1 topic / summary 漏關鍵
- 對策：Type 1 自動記 + 10 輪 summary + 交接 prompt 欄位

### 8.3 跨 topic 關聯遺失
- 症狀：半年後查「為什麼 credit-point 這樣設計」找不到討論記錄
- 根因：Type 2 派工 topic 無指向 Type 1 討論 topic 的連結
- 對策：Type 2 metadata 加 `derived_from`

### 8.4 並行 topic 數量失控
- 症狀：主 session 同時追 5+ topic，使用者 mental track 崩潰
- 對策：
  - 使用者視角：`mmsg topic-list --active` 看當前進行中
  - 主 session 每次回覆標 topic id
  - 建議並行上限 4-5 個

### 8.5 Summary 漏關鍵決策
- 症狀：LLM summary 文字看似合理，但漏掉業務紅線
- 對策：summary 產完主 session 檢查，漏則補

### 8.6 Sub-session 自推進
- 症狀：回報完不等放行就繼續做 → 主 session 來不及糾正，work 成 rollback
- 對策：§六 Race 處理規則

### 8.7 發包踩工具慣例坑
- 症狀：sub-session 不知「前端站點選擇用 websiteCascade 共用元件」類慣例，自建 API
- 對策：發包 prompt 按任務類型對應 guide 完整列必讀（各專案自訂 guide 對照表）

### 8.8 品質檢查延後（2026-04-20 實證）
- 症狀：code-reviewer 都等 commit 前才做 → 發現主程序 bug 要回改測試 + 程式
- 根因：測試全綠不等於程式好（測試只驗功能不驗品質）
- 對策：§七之二 兩輪時機強制（主程序完成後立即第一輪，commit 前第二輪）

### 8.9 多 Session Git Working Tree Race（2026-04-20 實證）
- 症狀：N 個 sub-session 並行改同一 repo，各自看到其他 session 的未 commit WIP → 誤 add / 誤 commit 到自己的 PR
- 具體案例：sub-session 跑 `git add .` / `-A` / `-u`（廣義 add）→ 意外把別 session 的改動 stage
- 對策 1（文件）：發包 prompt 明確列「working tree 可能有別 session WIP，你的 pathspec 嚴格限定 X/Y/Z」
- 對策 2（工具）：`git-guard-hook.sh` 廣義 add 已有警告（Part 3.5）+ 該加「add / commit 前先 git status 列出他人 WIP，要求確認」
- 對策 3（最根本）：各 sub-session 工作在**獨立 git worktree**，不共享同 working dir — 但 setup 成本高，短期不一定值得

### 8.10 主 session 拍板錯（2026-04-20 實證）
- 症狀：主 session 對 sub-session 的技術請示拍錯方向，session 跑後才發現
- 案例 1：canDispatch 邊界 `> 1` vs `>= 1` 拍錯（沒 grep facade 實作）
- 案例 2：Deposit 整合 A3 延後方向拍錯（忘了使用者「兩週上線」前提）
- 對策：§3.1 主 session 拍板三原則（對照實作 / 對照前提 / 業務上推）
- 救援：發現拍錯即刻撤回，明白標「撤回 seq=N」— 比硬著頭皮走下去便宜

---

## 九、工具支援對照

本模式依賴 Minitor 提供的基礎設施：

| 需求 | 工具 |
|------|------|
| 跨 session 訊息座標 | `mmsg topic-new` / `topic-add` / `topic-show` |
| 一 session 一記憶 | Type 1 topic（自動建立，hook 記錄）※ |
| 跨 session 檢索 | `mmsg session-search <keyword>` ※ |
| 壓縮救援 | `mmsg recovery` / `mmsg snapshot` |
| 10 輪提醒 | UserPromptSubmit hook 計數 + 自動 summary ※ |
| 交接 prompt | Type 1 topic 欄位動態維護 ※ |

※ 標記表示 Minitor Phase 7（2026-04-20 進行中）正在實作，尚未全部可用。

---

## 十、落地到新專案（給開源使用者）

### 10.1 安裝 Minitor

見本專案 README.md 的安裝指引。

### 10.2 啟用本模式

1. **設定專案 CLAUDE.md**：在專案根 CLAUDE.md 加一段引本 rules：
   ```markdown
   ## 多 Session 協作模式
   本專案採用多 session 發包協作，規則見：
   `{minitor 路徑}/docs/rules/multi-session-dispatch.md`
   ```
2. **Hook 設定**：Claude Code `~/.claude/settings.json` 加 UserPromptSubmit / PostToolUse / Stop 三個 hook（Minitor Phase 7 會提供範本）
3. **第一個 session 啟動**：Minitor 自動建 Type 1 topic 存該 session 記憶
4. **發任務給 sub-session**：主 session 用 `mmsg topic-new --title=...` 建 Type 2，把 topic id 告訴 sub-session
5. **遵守 §四 / §五 回報格式**

### 10.3 初始設定 checklist（全新使用者）

- [ ] 裝 Minitor（install.ps1）
- [ ] 啟動 tray app（右下角橘圖示）
- [ ] `mmsg help` 驗證 CLI 可用
- [ ] 複製 hook 範本到 `~/.claude/settings.json`
- [ ] 在專案 CLAUDE.md 加引本 rules 段
- [ ] 第一次開主 session → 看 Type 1 topic 是否自動建

---

## 十一、實例（2026-04-20 實證）

主 session 同時推進 4 個 topic：

| Topic | 類型 | 主題 |
|-------|------|------|
| (主 session 本身) | Type 1 | 當日主線推進 |
| `t-70e2f393` | Type 2 | Minitor 對話記錄恢復機制發包 |
| `t-9fa6be09` | Type 2 | admin-2614 廳主錢包操作發包 |
| `t-95fe329d` | Type 2 | credit-point 信用點模組發包 |

狀態：4 路並行。使用者透過 `mmsg topic-list --recent=24h` + 主 session 的 §四 格式回報，保持 mental track。

---

## 十二、相關文件

- Minitor 主 README：本專案根 README.md
- 專案端接力交接 SOP：各專案自有（e.g. Platform-BackendServer `docs/guides/principles/ai-collaboration/main-session-handoff.md`）
- 發包 prompt 模板：各專案自有（e.g. Platform-BackendServer `docs/guides/principles/ai-collaboration/dev-session-handoff.md`）
- 知識固化驗證 SOP：各專案自有

**定位差異**：
- Minitor 本 rules = 工具層 + 協作模式總則（跨專案通用）
- 專案內 ai-collaboration/* = 專案內具體落地（文件路徑、開發規範綁定）
