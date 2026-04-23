# Collab Framework — 多 Session 協作行為框架

> Claude Code 多 session 並行開發的協作規範與品質指導。
>
> 這個目錄整合了散落在多份文件 / memory 的協作規則，收斂為**兩層清晰邊界**：
>
> - **協作流程**：主場景與子場景「怎麼互動」的共通規範（主 + 子都讀）
> - **指導框架**：主場景管控「開發品質」的步驟 checklist（主場景獨掌）

---

## 為什麼這樣設計（Why）

接手本框架前，先懂以下 7 個設計決策。理解了 why，遇到邊界情況才知怎麼拿捏。

### 1. 為什麼建 collab-framework？

**問題**：協作規則原本散落在 Minitor rules + Platform-BackendServer ai-collaboration + 3 份 memory + 3 層 CLAUDE.md + 各 DECISIONS — 主場景憑記憶拼湊 → 每次發包漏項（實證：2026-04-21 漏 sys_menu + API 旁路；主場景剛寫的 memory 規則就違反）。

**解法**：單一權威版本 — 所有協作/開發規則集中在 collab-framework，其他處不再寫規則內容。

### 2. 為什麼分三份（1 / 2 / 3）？

職責邊界不同、讀者不同、變動性不同：

| | 1-collaboration-protocol | 2-development-playbook | 3-dispatch-reviewer-spec |
|---|---|---|---|
| 讀者 | 主 + 子 | 只主場景 | 工具實作者 |
| 性質 | 規範（怎麼互動）| 步驟（做什麼）| 工具規格 |
| 變動性 | 低（穩定少改）| 高（新踩坑即更新）| 中 |

**強行合一**會讓 sub-session 讀到不該管的指導框架、穩定協作流程被高頻更新的 checklist 稀釋、工具規格和規則內容混淆。

### 3. 為什麼 memory 只做 trigger、不藏內容？

memory 是主場景私有檔，**新 session 不一定會讀子 memory**（只讀 MEMORY.md 索引）。規則若塞在 memory 等於**黑洞**（實證：3 份協作 memory 剛寫就被主場景忽略）。

**解法**：memory 變純 trigger 索引（`關鍵字 → 讀 X 文件`），規則內容一律在規範正文。

### 4. 為什麼不建常駐判例庫？

每次主場景拍板都記為判例 → 幾百則累積 → **AI 看到長文自動 pass** → 倒退回「憑記憶推測」。這和 memory 黑洞同本質。

**解法**：
- 候選判例庫（`ref/candidate-precedents.md`）**平常不 load**，只記使用者拍板結果避免遺忘
- 使用者**觸發整理**才讀 → 重複出現者升級進規範正文、一次性 / 過時者廢止
- 規範正文只長當前有效條目，不爆炸

### 5. 為什麼需要 dispatch-reviewer agent + hook？

規範寫好 ≠ 主場景會讀 / 會走 checklist（2026-04-21 實證：checklist §A.2 列 13 項，主場景**沒走**）。**靠自律不可靠**，需外部強制。

**解法**：PreToolUse hook 攔截 `mmsg topic-new/add --author=main-scene` → 自動 call reviewer agent → 缺項 exit 2 block → 主場景**無法跳過**。紀律外部化。

### 6. 為什麼 §B.0.5 第一輪思考回饋（DDD 業務先行）？

Sub-session 收到發包常「照單全收」不質疑 → 業務 ↔ 設計不對齊的問題**到 P5 測試才發現**，返工成本高。

**解法**：進 P1 前強制 sub-session 推演 4 點（對齊 / 模糊 / 衝突 / 建議），主場景收到第一輪 feedback → 補資訊 / 上推使用者 / 修 DESIGN 後再 ack。問題在設計階段就抓。

### 7. 為什麼 §C 驗證問題要三層（核心 / 範圍 / 反例）？

只問「這個規範是什麼」→ sub-session 可**抄原文**過關（沒真讀懂）。

三層驗證：
- **核心概念**：有讀到要點嗎（防 skim）
- **應用範圍 / 邊界**：知道什麼時候不用嗎（防死板照做）
- **踩坑反例**：理解到 deep enough 嗎（防表面理解）

三層都過 = 真讀懂，不是背書。和 knowledge-validation-sop 的 Round 1/2（10-15 題 / 模組級）不同，§C 是 Phase 級日常版（3-5 題）。

---

## 一、目錄結構

```
collab-framework/
├─ README.md                       ← 你在這裡（入口）
├─ 1-collaboration-protocol.md     ← 協作流程（主+子必讀）
├─ 2-development-playbook.md       ← 指導框架（主場景獨掌）
├─ 3-dispatch-reviewer-spec.md     ← 檢查 agent 規格（工具層）
└─ ref/                             ← 參考資料（平常不 load）
   └─ candidate-precedents.md      ← 候選判例庫（使用者觸發整理才讀）
```

**原則**：**單一權威版本**。新框架定稿後：
- 主目錄留 4 份新文件（README + 1 + 2 + 3）
- `ref/` 放「平常不讀」的參考資料（候選判例庫 + 未來其他暫存類）
- 整合用的 9 份源檔副本全數刪除（已完成整合後）
- 源頭處的散落文件也拔除（見 §五 拔除清單）
- 所有引用點（CLAUDE.md 類）指向 collab-framework

避免新舊雙版本衝突、資訊散落造成協作誤用。

## 二、讀者指引

| 角色 | 該讀 | 不讀 |
|------|-----|-----|
| **使用者（業主）** | 全部（總覽）、重點是 §1 和 §2 §A Phase 順序 | 3-reviewer-agent-spec（工具實作層，非必要）|
| **主場景** | **全部**，特別是 2 指導框架 | 源檔只在新框架缺項時回查 |
| **Sub-session（子場景）** | **只讀 1 協作流程** + 該任務發包 prompt 指定的必讀 | 2 指導框架（非你管轄，主場景給你當下 Phase 的 checklist） |
| **dispatch-reviewer agent** | knowledge base = 1 + 2 | — |

---

## 三、兩層定位

### 協作流程 (1-collaboration-protocol.md)

**回答問題**：「多個 session 怎麼互動？」

內容性質：**規範**（穩定、少變動）
- 三角色職責邊界
- topic / mmsg 機制
- 發包與回報格式
- Race 規則 / 破壞性保護 / 協作紀律

主 + 子都要讀到同一版，才不會協作錯位。

### 指導框架 (2-development-playbook.md)

**回答問題**：「主場景當下這步該做什麼？該送給 sub-session 什麼？」

內容性質：**步驟**（隨 Phase / 新踩坑即更新）
- Phase 順序總覽
- 各 Phase checklist（可勾選）
- **Phase 交界處送 sub-session 什麼**（避免 ctx 稀釋的核心）
- 判斷門檻（何時進下一 Phase / 插 reviewer / 等使用者）

主場景發包前、每 Phase 放行前查詢，不塞給 sub-session（否則 sub-session 被淹沒）。

### 檢查 Agent 規格 (3-dispatch-reviewer-spec.md)

**回答問題**：「主場景的發包/放行訊息漏東漏西怎麼辦？」

工具層：把「指導框架」自動化成發包前 sanity check。

- Knowledge base 指向 1 + 2
- Input：主場景的發包 / 放行訊息 draft
- Output：✅ 通過 / 🟡 缺漏清單 / 🔴 風險示警
- 搭配 PreToolUse hook 強制 call（主場景發 mmsg 前自動觸發）

---

## 四、源檔映射（整合了哪些？）

| 新文件 | 整合自 |
|---|---|
| 1-collaboration-protocol | multi-session-dispatch §一~六 / main-session-handoff §二 三層機制 / 3 份協作 memory 全內容整合 |
| 2-development-playbook | multi-session-dispatch §七之二~三 + §8.11 / dispatch-prompt-handbook 全 / knowledge-validation-sop / 新設計「Phase 交界送 sub 什麼」 |
| 3-dispatch-reviewer-spec | 新設計（knowledge base 指前兩份）|

**memory 定位**：MEMORY.md / memory/ 僅為 **trigger 索引**（`關鍵字 → 觸發讀 X 文件`），**不藏規則內容、不藏個人偏好**。3 份協作 memory 內容搬入 collab-framework 後刪除。

**源檔拔除**：見 §五 拔除清單（含 memory 改造 + CLAUDE.md 清洗）。

---

## 五、拔除清單（新框架定稿後執行）

### 階段 1：確認新框架無漏
1. 寫完 1/2/3
2. 用實際任務走一遍（例如 admin-2615 P9/P10 當試驗）
3. 使用者確認新框架涵蓋所有必要協作規則

### 階段 2：拔除 collab-framework 內副本
刪除本目錄 9 份副本（都是為整合過濾而複製）：
- multi-session-dispatch.md / dispatch-prompt-handbook.md
- main-session-handoff.md / dev-session-handoff.md / knowledge-validation-sop.md / ai-collaboration-README.md
- memory-chrome-devtools-ui-verify.md / memory-user-report-qa-format.md / memory-commit-skip-docs.md

### 階段 3：拔除源頭散落文件
- **Minitor**：刪 `claude-status-monitor-4-windows/docs/rules/multi-session-dispatch.md` + `dispatch-prompt-handbook.md`
- **Platform-BackendServer**：刪 `docs/guides/principles/ai-collaboration/` 整個目錄（README / dev-session-handoff / main-session-handoff / knowledge-validation-sop）

### 階段 4：改造 memory 為純 trigger 索引
- **刪 3 份協作 memory 內容檔**：
  - `feedback_user_report_qa_format.md`
  - `feedback_chrome_devtools_ui_verify.md`
  - `feedback_commit_skip_docs.md`
- **重寫 MEMORY.md** 成 trigger 索引，例：
  ```markdown
  ## Trigger 索引
  - 關鍵字「協作流程」→ collab-framework/1-collaboration-protocol.md
  - 關鍵字「協作流程-指導」→ collab-framework/2-development-playbook.md
  ```
- 其他 memory（project / reference / business feedback）本輪不動，但長期應逐一檢視（是規則 / 是業務狀態 / 是個人偏好），按各自歸宿處理

### 階段 5：清洗 CLAUDE.md（三層級）
- **workspace `C:/workspace/CLAUDE.md`**：
  - 移除 Minitor 段的規則內容（MMSG 速查、用法、典型流程、接手方法論等）
  - 只留 trigger 引導：「多 session 協作規範 → 見 `claude-status-monitor-4-windows/docs/collab-framework/`」
- **`C:/workspace/_plarform/CLAUDE.md`**：同樣移除協作規則內容，改 trigger
- **`C:/workspace/_plarform/Platform-BackendServer/CLAUDE.md`**：
  - 移除 ai-collaboration 引用
  - 改 trigger 指 `collab-framework/`
  - 保留專案基本資訊（路徑、技術棧、port、DB 連線等事實）

### 階段 6：更新其他引用點
Grep 搜以下路徑的引用，改指向 `collab-framework/`：
- `docs/rules/multi-session-dispatch.md`
- `docs/rules/dispatch-prompt-handbook.md`
- `docs/guides/principles/ai-collaboration/`
- `feedback_user_report_qa_format` / `feedback_chrome_devtools_ui_verify` / `feedback_commit_skip_docs`

---

## 六、使用流程（待補）

> 1/2/3 寫完後這節補完整。預計包含：
> - 新 session 啟動該讀什麼
> - 主場景發包時的 workflow（含 dispatch-reviewer call）
> - hook 設置（`settings.json` 配置）
> - 規則更新流程（誰有權改哪份）

---

## 七、維護原則（職責清楚 = 改哪份明確）

| 要改什麼 | 改哪份 |
|---|---|
| **協作流程**（角色邊界 / 發包回報格式 / Race / 交接）| `1-collaboration-protocol.md` |
| **開發步驟 / Phase checklist**（什麼時候做什麼 / 送 sub 什麼）| `2-development-playbook.md` |
| **檢查 agent 規格 / hook 機制** | `3-dispatch-reviewer-spec.md` |
| **新 trigger 關鍵字**（讀到 X 觸發讀 Y）| `MEMORY.md`（純索引）|
| 業務規則 | 各專案的 PLAN / DECISIONS / design（不屬本框架）|

其他原則：
1. **單一權威版本** — 協作/指導規則**只在** collab-framework 1/2/3；memory / CLAUDE.md / 其他散落文件**一律不寫規則內容**
2. **Memory 只做 trigger** — 不藏內容、不藏個人偏好；格式 `關鍵字 → 觸發讀 X`
3. **CLAUDE.md 清洗** — 不寫規則，只寫專案基本資訊（路徑 / 技術棧 / port / DB 等事實）+ trigger 索引；三層級（workspace / _plarform / Platform-BackendServer）同此標準
4. **協作流程變動低** — 穩定後很少改；有變動主+子 session 都同步 load
5. **指導框架高頻更新** — 每個新踩坑 / 新 Phase 優化都寫進去；保持 checkable 格式

---

## 八、版本

- v0.1 — 2026-04-21 建立骨架（階段：1/2/3 寫作中）
