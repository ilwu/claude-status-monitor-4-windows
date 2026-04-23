---
status: active
created: 2026-04-21
purpose: business-derivation (template)
version: v0.1
---

# 業務推導文件（廳主視角）

> **這是 template，提供重點資訊骨架**。
> 細節業務規則在其他文件（FUNC_DESIGN / DECISIONS / README）— 按步驟 1 必讀清單讀。
> 不清楚的地方：**查 graphify MCP 工具** 或 Grep / Read code 探索。
> 本文件持續推演中（系統設計哲學會補）。

---

## §0 業務格局

```
平台（SaaS 提供者 / admin）
  │ 維運、接遊戲商、接金流、提供 Plugin 框架
  ↓ 線下談：租約 / 賣信用點
廳主（業主 = 娛樂城經營者）  ← 業務主體
  ├─ 代理（拉會員業務員，可多層）
  │    └─ 會員（玩家）
```

- 多廳主**完全隔離**（website 層）
- 平台經營者 + 客服 = 後台操作人員，服務多廳主
- `admin-xxx` 是「管理後台」暱稱，不是平台經營者專屬（廳主常用）

---

## §1 廳主選擇營運模式

| 模式 | 會員金流 | 系統責任 |
|---|---|---|
| 純信用點 | 線下處理 | 只記投注量 + 佣金分配 |
| 真錢存提款 | 會員真錢進出站 | 走 sys_recharge_order / sys_withdraw_order，手續費三源觸發 |
| 混合 | 自選比例，**風險自負** | 按實際事件 |

控制：系統參數關 / 開存提款（舊系統非完整設計，TODO-18 在做）。信用點功能永遠開（admin 轉給廳主 = 新籌碼進站）。

---

## §2 廳主賺錢邏輯

**廳主盈利 = 會員輸 − 會員贏 + 手續費 − 代理佣金 − 平台費**

- 自己拉會員成本高 → 找代理
- **代理 = 業務員**，給佣金激勵
- 佣金是**廳主的扣項**（不是平台的成本）

---

## §3 代理網絡

- 代理可找下線代理 → **override 鏈**
- 會員永遠掛某個代理（`member.parent = agent._id`，推廣碼綁定）
- 業務激勵：**上級關心下級**培養會員 → override 層層抽成
- **終止於 HALL**（廳主不拿 override — 業主不從自己抽）
- 多廳主 override 不跨（站點隔離天然實現）

---

## §4 佣金怎麼算（Plugin 化）

- 業務規則**不在框架，在模型內**（NGR 現有 / 未來新模型）
- 新玩法 = 實作新 **SubModule**，直接切換
- 觸發源由模型定（NGR 要求四源：`BET_SETTLEMENT` + `RECHARGE_FEE` + `COMPANY_DEPOSIT_FEE` + `WITHDRAWAL_FEE`；`FAVOUR_TRANSFER` 待實作）
- Trigger 即時 + Job 掃漏 **互補兜底**（都用狀態欄位 + 鎖 + 鎖內冪等）
- 晉升規則、手續費分擔率 = 模型內設定（廳主 / 客服可調）

### 時間向的處理 — 週期結算，不做固定薪水

佣金**永遠是 event-driven**（注單 / Fee / FAVOUR 等事實單據才分錢）。

時間向的需求用 **PERIODIC 週期結算**處理，不是 time-driven 憑空給錢：
- **週期結算**：排程到時間把代理**累積段金額 ≥ 1** 的建 release 單走審核（PLAN §11.6 規格已定）
- 本質仍是 event-driven（事實已累積），排程只是「把累積變現」的觸發點
- **不做固定薪水式給錢**（業務上沒此需求）

### 分流主軸 — 按「接收者」分路徑

業務給錢的路徑按**接收者**分流，不按觸發類型：

| 路徑 | 接收者 | 風控機制 | 狀態 |
|-----|--------|---------|------|
| **佣金** | 代理 | D31 互斥群組 + D60 一代理一業務 | 現行 |
| **優惠** | 會員 | ParallelMode（PARALLEL 並行 / EXCLUSIVE 互斥）| 現行 |
| **會員返佣** | 會員（邏輯比一般優惠複雜）| 獨立模組 | 未來設計（不塞優惠架構）|

**為什麼接收者是分流主軸**：
- 優惠是**給會員的誘因**（攬客 / 留客），設計對象是會員
- 佣金是**給代理的業務員酬勞**（業務員激勵），設計對象是代理
- 兩者業務本質不同，不能因「都是給錢」就合在一起

**新業務需求判斷**：
- 給代理 → 走佣金（擴 SubModule，用 D31 互斥機制）
- 給會員的簡單獎勵 → 走優惠（新增 SubModule，ParallelMode 管風險）
- 給會員的複雜邏輯（如會員返佣）→ 獨立模組（避免優惠架構變「會員福利百科」）

### 優惠模組的風險控制機制（ParallelMode）

優惠模組用 **PARALLEL / EXCLUSIVE** 兩類機制控制風險爆炸：

| 類別 | 行為 | 適用 | 風險特性 |
|-----|------|------|---------|
| **PARALLEL 並行** | 符合條件**一定觸發**、不受其他優惠影響 | 生日禮金、抽獎資格（固定獎品）、返水 | 固定成本，發 1 萬張抽獎券也不會風險爆炸 |
| **EXCLUSIVE 互斥** | 同組內**只觸發優先權最高**的一個 | 投注滿額送、首儲加碼（高獎勵類） | 防止同筆行為觸發多個高獎勵導致套利 |

核心精神：**業主可以一直加新模組，EXCLUSIVE 制度保證高風險類一次只觸發一項，PARALLEL 類限制在風險可控範圍**。

技術細節見 `docs/guides/domain/favour-guides/issues/ISSUE-02_優惠觸發並行互斥機制.md`。

---

## §5 停用代理時佣金處理

**業務直覺**：代理沒了，會員繼續玩（代理是配角，會員才是金流主角）

- 源頭代理停用 → 注單結算 `commissionStatus=SKIPPED`，不寫佣金
- 消失份額 = 扣項沒產生 = 廳主盈利自動多
- Override 鏈中間停用：那層不寫，**其他層不重分**（同理）
- 恢復佣金 = DB 改狀態 / 線下談（**不做功能，案例太邊緣**）

---

## §6 佣金怎麼到代理手上

### 三段錢包（廳主的檢視節奏）

```
[累積段 pendingRelease]
   ↓ 廳主控節奏
[可提款段 withdrawable]
   ↓ 出金三路徑
[totalWithdrawn / 中心錢包]
```

**為什麼三段**：廳主需要**檢視窗口**（怕代理跑路 / 錯發 / 對帳）

### 發放路徑

- 代理自助申請 → 廳主審（2613）
- 廳主直接發放（2614，跳審核，對應**線下談 / 緊急清帳 / 口頭承諾兌現**）
- 排程自動（PERIODIC，未實作；和 2614 **不互斥** — 是不同時間區間的錢）

### 出金路徑

- `transferToCenter` — 代理自己也是玩家，轉中心錢包消費
- `directWithdraw` — 真錢模式，建 `sys_withdraw_order cashType=COMMISSION`（用 member 卡 D68）
- **`offlineSettle`** — **信用點模式主要路徑**，廳主線下付代理真錢，系統扣帳記 ledger

---

## §7 代理 member 身份（D68）

廳主思考：平台既有**提款模組**（銀行卡 / 風控 / 審核）整套**設計對象是 member**。

- 代理要走提款 = 必須有 member 身份
- 建代理時**同步建 member**：
  - 有 member（玩家升代理）→ 綁既有
  - 無 member（廳主直建）→ 建 **LOCK 態 placeholder member**（密碼空 + 狀態鎖，防刷）

---

## §8 代理停用 / 軟刪清帳

- 軟刪 = 代理錢包餘額是**代理合法權利**（業主不能黑吃）
- 廳主三清帳工具：
  1. **2614 廳主直接發放**（累積段 → 可提款段）
  2. **`offlineSettle`**（可提款段 → 線下付錢扣帳）
  3. **`transferToCenter`**（代理也是玩家時轉中心）
- **不做 reactivate**（業務沒這需求；代理沒了就是沒了）

---

## §9 信用點 = 投注量容量（不是錢）

### 業務模式

- 平台**賣**廳主 1000 萬信用點 = 1000 萬投注量**容量**
- 廳主分代理 → 代理給會員加扣款連動（消耗容量）
- 用完再買
- **會員籌碼的真錢兌換，網站不負責**（廳主線下處理）

### 關鍵設計

- **1 點 = 1 元** 是內部單位，不是錢
- `Math.floor(amount/100)` 保守（平台多給容量自己虧）
- admin → 廳主 = **憑空發**（因為平台賣了，系統內是發放）
- 扣 `target.parent` 不扣 operator（operator 只是下指令的人）
- **(c) 事實驅動**：pending 不動容量 / approve 時才扣（會計原則）

和佣金獨立，但同 Plugin 哲學（SubModule）。

---

## §10 廳主的帳是減法

- **會員輸 − 會員贏 + 手續費 − 代理佣金 − 平台費 = 廳主賺**
- **不精確統計進項** — 廳主自己知道做了什麼
- 消失份額（override 到 HALL / D63 SKIP）= 扣項沒產生 = 自動反映

---

## §11 平台經營者（另一條線，非業務主體）

- **維運網站** / **接遊戲商** / **接金流商** / **系統支援**
- **客服代操**：服務多廳主（廳主可不自操）
- **多廳主完全隔離**（website 層）
- 提供 Plugin 框架：業務模型 / 觸發器 / 錢包 / 優惠 / 信用點
- **不干涉廳主業務決策**（符合「不能用系統管業主」）

---

## §12 各角色做 / 不做

| 角色 | 做 | 不做 |
|---|---|---|
| **平台經營者** | 維運 / 三方接入 / 客服代操 / 提供 Plugin | 業務決策 / 審代理 / 干涉廳主 |
| **廳主**（業主）| 所有業務決策 / 管代理 / 發放 / 看盈利 / 選模式 | 改業務模型框架 / 看別廳資料 |
| **代理** | 拉會員 / 管下線 / 申請發放 | 改自己佣金設定 / 搶別代理會員 / 自審發放單 / 經手金流（除 offlineSettle 線下）|
| **會員** | 玩 / 真錢存提（真錢模式）| 選代理 / 看佣金邏輯 / 管帳務 |

---

## 系統設計哲學

### 主原則

**用框架設計出護欄，讓做對的事是自然的，做錯的事是困難的。**

### 設計思考核心：解耦

**設計思考的核心是解耦**。

系統會不斷腐化，來自於**後續不斷的修改**：
- 一開始的設計完滿框架**不一定滿足後面的需求**
- 最後造成一堆 `if-else` 交互
- 新舊原則互相影響 → 牽一髮動全身

**解決方式**：將會變動的區塊**包裝成 Plugin + 定義接口**，實作差異化業務邏輯。

### Plugin 化的三大效益

| # | 效益 | 落地 |
|---|------|------|
| 1 | **新規則不影響舊** — 各自獨立 | 隨時新增新玩法模型（佣金 SubModule）<br>隨時新增新優惠模型（優惠 SubModule）<br>新舊共存不碰撞 |
| 2 | **縮小思考邊界** — 越複雜越容易錯 | ctx 也變少（session 只需讀本 Plugin + 共用介面，不需全域理解） |
| 3 | **保證品質** — 縮小測試範圍 | 新 Plugin 的測試只驗本 Plugin + 介面契約，不回頭跑整個系統 regression |

### 探針（Trigger）設計 — 解耦的另一切面

除了 Plugin 化，解耦還有**另一手段：探針**（Trigger = 事件驅動）。

**核心精神**：
- 業務模組在某個行為邏輯路徑上**插入探針**
- **不是**實作路徑**去呼叫**某模組（`A.foo() → B.foo()` 的耦合）
- **是**路徑執行中**觸發**模組的探針 — 路徑產生事件，模組的探針監聽、模組內部自處理
- **業務路徑不知道模組內做了什麼** — 知識隔離 / 控制反轉

**現有系統的實例**：

| 業務路徑（不知道誰在監聽）| 插入探針的模組（自主處理）|
|---|---|
| 注單結算 | 佣金 Trigger（SubModule 自查自算 D15）<br>統計 Calculator（自扣）<br>風控 MonitorCalculator |
| 優惠錢包 → 中心錢包 | 佣金 Trigger（FAVOUR_TRANSFER D29）|
| Fee 三源（充值 / 公司存款 / 提款手續費）| 佣金 Trigger（Fee Commission 三 Job）|
| 代理 release 審核通過 | Ledger 寫入 / Override chain 級聯 |

**探針 vs Plugin 的切面差異**：

| 切面 | 解耦對象 | 典型工具 |
|-----|---------|---------|
| **Plugin** | 同一類業務的**變體**（NGR / RevenueShare / 未來新玩法）| `SubModule.calculate()` 介面 |
| **探針** | **跨模組事件**（注單 → N 個不同模組）| `Trigger` + 狀態欄位 (`commissionStatus=0` 待處理) |

**核心結論**：
- 兩者都是**對抗系統腐化**的具體手段
- 組合使用：業務路徑**插探針**通知，對應模組**用 Plugin** 擴展變體
- 業務路徑永遠**瘦**（只發事件）、模組永遠**內聚**（自收事件、自處理）

技術細節：`docs/guides/principles/trigger-philosophy.md`（B.1.Y 即時探針 / B.2.X 純觀察 / B.2.Y 狀態輪詢 互補兜底）

### DBOperation + 交易鎖 — 金融級正確性護欄

**組合精神**：
- **DBOperation**：批次收集 DB 操作，交給 `TransactionLockScope` 一次執行
- **交易鎖**：保證並發正確（多 session 搶同資源互斥）
- 組合 = **批次原子性 + 並發正確性 + 鎖內冪等**

**為什麼需要**：資料錯 = 金錢損失。半套寫入（部分成功部分失敗）是金融系統最危險的狀態，必須「全成功 / 全回滾」。

**落地規則**：
- 鎖內**取最新資料**（避 TOCTOU）
- 鎖內**冪等**（重入一樣結果，避重複觸發）
- 一個 `lockScope` **管多類型鎖**（避雙 lockScope 死鎖）
- 鎖**用時才加**（不預先全加），容器一起釋放
- 單向遍歷（下→上 override chain）= 沒循環等待 = 沒死鎖（D47）

技術細節：`docs/guides/framework/transaction-lock-guides/`、`architecture-guides/README.md` DbOperation Dirty Read Risk 段。

### 門面模式（Facade） + 託管資料表不可侵入

**組合精神**：
- 每個業務模組**託管**自己的 Tables（owned tables）
- 外部模組**不得直接 import / 操作**託管 Table
- 所有跨模組存取**必須透過 Facade**（模組唯一對外入口）

**為什麼需要**（對應 Plugin / 探針的解耦主軸）：
- **內聚**：模組內部欄位 / 索引 / 規則可自由重構，外部零感知
- **一致性**：所有寫入經 Facade 集中驗證 / 日誌 / 事件，不會被某外部模組繞過
- **邊界強制**：新 session 讀模組時，只要讀 Facade 介面即夠（ctx 節省）

**落地規則**：
- 託管 ≠ 唯讀；可讀但**寫必過 Facade**
- Facade **純委派**（D14）— 不做編排 / DTO 組裝（那是 BusinessFacade 的事）
- 不得 import 其他模組的 Entity（D7：代理模組不 import 錢包 Entity）

**反模式**（module-boundary-checker agent 會擋）：
- 直接 `import SysXxxService` 做寫入 → 繞過 Facade 的驗證 + 事件機制
- 合併多個獨立查詢的 DBOperation → **髒讀風險**（跨交易邊界讀）
- 在 Facade 寫業務編排邏輯（違反 D14 純委派）

**實例**：
| 託管模組 | 託管 Table | 對外 Facade |
|---------|-----------|-------------|
| 錢包 | `agent_commission_wallet` / `wallet_trans_record` | `WalletForAgentCommissionFacade`（D7）|
| 佣金 Config | `sys_commission_config` / `sys_commission_template_log` | `CommissionConfigBusinessFacade`（D50）|
| Ledger | `commission_record` | `AgentLedgerDomainFacade.buildEntryOp` |
| 統計 | `statistics_*` 表 | `StatisticsFacade` |

技術細節：`docs/guides/principles/architecture-guides/README.md`（BusinessFacade / DomainFacade / 分層職責）。

### 綜合實例 — 統計模組

統計模組是前面四大解耦手段的**綜合體現 + 新增維度**。

**核心哲學**：**統計是衍生資料，不應拖累核心交易**（金融級交易 vs 系統擴充性，用事件驅動把兩者解耦）。

六項關鍵決策與對應手段：

| 決策 | 對應手段 | 解決什麼 |
|-----|---------|---------|
| **事件驅動 + 60 秒批次排程**（取代即時 DB 更新）| 探針設計 | 交易路徑僅 +1 次 Redis SADD（O(1)）；統計失敗不連累主交易 |
| **只推 `table:id`**（不推完整資料）| 資料一致性 | Redis 只當觸發器；排程時撈最新 record（含最終狀態）|
| **Redis Set + RENAME 原子認領** | 分散式無鎖 | 多 PM2 實例 CronJob 不衝突；不需外部鎖 |
| **三層容錯**（PENDING / PROCESSING 雙 key）| 健壯性護欄 | 成功清除 / 失敗放回 / 崩潰恢復；啟動時自動修復 |
| **Calculator 獨立**（統一介面）| Plugin 化 | 新增統計維度 = 新 Calculator，不動主流程 |
| **MongoDB `$inc` 增量**（取代 `set`）| 原子更新 | 多 Calculator 更新同報表不同欄位互不干擾；避免 read-modify-write |

**最妙的組合效益**：
- **60 秒延遲換交易路徑 0 負擔**（主交易僅 +1 次 Redis SADD）
- **批次合併**：60 秒內 100 筆同一會員充值 → 合併為 1 次 upsert
- 業務路徑發探針 → 統計模組獨立聚合 → 多 Calculator 原子 upsert，無鎖、無競態、可擴充

**這個設計告訴我們**：金融級正確性（交易）和系統彈性（統計維度無限擴充）**不必衝突** — 用**事件驅動批次**把兩者徹底解耦。

技術細節：`docs/guides/domain/statistics-guides/collection/02-DESIGN-DECISIONS.md`（六項決策完整 why）。

### Tables Builder — 以編譯錯誤對抗欄位/型別錯誤

Tables 模組提供**流式 Builder API**（`query() / update() / insert() / delete()`），而非直接操作 Entity / `model.findOne()`。

**三層防護**：
- **欄位名稱** — 拼錯在 tsc 階段就 catch（不等 runtime 炸在業主臉上）
- **型別正確** — `String` / `Number` / `ObjectId` 等型別不匹配 tsc 炸
- **書寫一致** — 降低跨開發者慣用差異造成的維護難度（有人 `findOne().lean()` / 有人 `findById()` / 有人 raw model → Builder 強制走同介面）

```typescript
// ❌ 繞過 Builder：拼錯欄位名 tsc 不會炸（runtime 才發現）
await this.adminUserService.model.findOne({ nmae: 'admin' }).lean();

// ✅ Builder：欄位拼錯 tsc 立刻炸
await this.adminUserService.query()
  .where('name', 'admin')
  .first();
```

**核心精神**：**盡量讓錯誤在 tsc 階段被發現** — 編譯期錯誤比 runtime 錯誤便宜 N 個量級（尤其金融資料）。

技術細節：`docs/guides/framework/tables-guides/`（QUICK-START + ENTITY-GUIDE + BUILDER-API-REFERENCE）。

### 其他護欄（簡列 + 指引文件）

系統還有其他對抗腐化 / 保證一致性的護欄，本文件不展開（避免補不完）。查對應 guide：

| 護欄主題 | Guide |
|---------|-------|
| i18n 12 語 + ErrorCode 多語對應 | `framework/i18n-guides/` |
| 排程框架（CronJob）| `framework/scheduler-guides/` |
| Cache 分層 | `framework/cache-guides/` |
| Interceptor | `framework/interceptor-guides/` |
| Decorators（`@CentsField` 金額 / `@ConfigField` 遊戲商 config）| `framework/decorators-guides/` |
| Ledger 寫入統一（`buildEntryOp`）| `framework/agent-ledger-guides/` |
| Batch 交易模式 | `framework/batch-transaction-pattern/` |
| Dynamic Fields（動態欄位驗證）| `framework/dynamic-fields-guides/` |
| Logger（Log4js）| `framework/logger-guides/` |
| System Alert | `framework/system-alert-guides/` |
| 編碼規範（四層 tag 🛡️⚠️🏗️📐）| `principles/coding-guidelines/` |

**使用方式**：任務觸及哪條護欄 → 讀對應 guide，不靠本哲學段涵蓋所有細節。

### 落地三鏈

```
職責邊界清楚  →  去耦合  →  縮小思考範圍（ctx 節省）
```

**解耦是三鏈的核心**：職責邊界是「解耦的分界線」、縮小思考範圍是「解耦的效益」。

**五大解耦 / 護欄手段**，各服務同一目的 — **對抗系統腐化**：

| 手段 | 切面 |
|-----|------|
| Plugin 化 | 同類業務的變體可插拔 |
| 探針設計 | 跨模組事件觸發，業務路徑解耦 |
| DBOperation + 交易鎖 | 金融級原子性 + 並發正確 |
| Facade + 託管不可侵入 | 模組內聚 + 邊界強制 |
| Tables Builder | 編譯期抓錯 + 書寫一致 |

統計模組是這些手段的綜合實例。其他護欄見上方指引文件清單。

### 為什麼這樣設計

**1. 金融級正確性**
- 資料錯 = 金錢損失
- 型別 / 驗證 / 冪等 / 鎖 / 精度 不能省

**2. 團隊開發 + 長期維護**
- 多人協作：規範的目的是**統一共識**，不是追求最優寫法
- 每個人觀點不同（平鋪直述 vs 炫技一行）— **不能說誰錯，但不一致就是問題**
- 功能做出來的那一刻還不夠，**後面防系統腐化**

### 四層防護（每條規則的分類 tag）

| 標記 | 層級 | 效果 |
|---|---|---|
| 🛡️ | 框架防呆 | 框架擋錯，開發者不用記 |
| ⚠️ | 陷阱消除 | 安全寫法替代危險寫法 |
| 🏗️ | 架構紀律 | 分層職責防系統腐化 |
| 📐 | 一致性 | 統一風格降認知負擔 |

### 完整規則 → 指向權威文件

- `docs/guides/principles/coding-guidelines/README.md` — 10 節完整規則 + 8 條開發時必記（框架幫不了，只能紀律）
- `docs/guides/principles/coding-guidelines/REFERENCES.md` — 理論出處（參考用）
- `docs/guides/principles/coding-guidelines/CHECKLIST.md` — Code Review 檢查清單

### 具體護欄實作

Tables 模組 / ValidationPipe / Interceptor / class-validator / TransactionLockScope / git-guard-hook / dispatch-reviewer hook

---

## 協作模式

**跨專案通用規範**：`claude-status-monitor-4-windows/docs/collab-framework/`

本節只概述；細節讀該目錄文件。

| 文件 | 做什麼 | 讀者 |
|---|---|---|
| `README.md` | 入口 + **7 個 Why 設計理由**（先懂 why 再看 what） | 所有人先讀 |
| `1-collaboration-protocol.md` | **協作互動機制** — 三角色邊界 / mmsg 機制 / 發包回報格式 / Race 規則 / 協作紀律 | 主 + 子 session 都讀 |
| `2-development-playbook.md` | **主場景步驟手冊** — Phase 順序 / 各 Phase checklist / 交界送 sub 什麼 / 判斷門檻 / task→guide 對照表 | 只主場景 |
| `3-dispatch-reviewer-spec.md` | **檢查 agent 規格** — hook + agent 把紀律外部化（主場景發包 / 放行前 sanity check） | 工具實作者 |

**補充**：`ref/candidate-precedents.md` — 候選判例庫（使用者拍板結果記錄，平常不 load；使用者觸發整理時升規範或廢止）

---

## 維護

- 本文件持續更新（使用者補業務缺口 + 推演系統設計哲學）
- 發現業務理解偏差 → 立即回補
- D 編號新增 → 相關段補「查 D X」引用（細節**不展開**）
- **職責邊界**：本文件 = 骨架，原文件（FUNC_DESIGN / DECISIONS）= 細節，不複製過來
- 不清楚的細節 → graphify / code 探索（不要硬寫錯）
