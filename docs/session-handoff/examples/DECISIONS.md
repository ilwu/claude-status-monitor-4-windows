---
status: active
created: 2026-04-08
updated: 2026-04-19
---

# 代理佣金 — 設計決策記錄

> 設計過程中確認的規則和被否決的方案。防止重複討論。
> 編號（D1~D68）保留歷史，**過時條目保留殼 + 指向新條目**，避免既有文件引用失效。

---

## 主題索引（按議題分組）

**讀法（session 先看這節）**：
1. **想查什麼**就**先查本表**（三欄：主題 / D 編號 / 廢止替代）
2. 找到主題 → 跳到該 D 編號讀完整規則
3. 看到 ~~Dxx~~「被取代」→ 跳到替代條目，**不要把舊條目當真實決策**
4. 表格沒列的主題（如 PERIODIC 規格 / Fee Commission 設計）→ 看下方「跨文件索引」

| 主題 | 現行條目 | 廢止 / 併入 |
|------|---------|-----------|
| **錢包架構** | D1 D2 D3 D7 D8 D9 D10 D12 D13 D60 D61 | ~~D6~~→D60、~~D11~~→D60 |
| **Ledger（佣金明細）** | D4 | — |
| **引擎架構** | D5 D14 D15 D17 D18 D19 D29 | ~~D16~~ 被 D20 取代 |
| **精度規則（計算 / 發放 / 出金三階段）** | **D22** | ~~D62~~→D22 |
| **佣金計算（NGR / override / 模型）** | D21 D24 D25 D26 D27 D28 | — |
| **互斥與業務模型** | D31 | ~~D23~~→D31 |
| **發放流程（release order / override chain）** | D30 D32 D36 D37 D47 D64 | — |
| **分傭設定（ConfigMode / TEMPLATE / TIER）** | D33 D34 D35 D39 D50 D51 | — |
| **晉升體系（TIER）** | D38 D43 | — |
| **後台頁面架構** | D40 D41 D42 D44 D45 D46 D48 D49 | — |
| **代理停用/凍結/恢復（含 override / cascade）** | **D63** D65 D67 **D69** | ~~D66~~→D63 |
| **代理-member 連動（建立 / 狀態連動 / 命名）** | **D68** | — |
| **凍結狀態 + 下線 cascade（停用/凍結/軟刪三態規則）** | **D69** | — |
| **業務角色框架（平台/業主/代理）** | **D65 §一** | — |
| **業務模型（具體）** | D20 D60 | — |

### 跨文件索引（D 編號沒涵蓋的規格）

以下主題沒有獨立 D 編號（規格寫在其他文件），session 依主題直接跳：

| 主題 | 查哪裡 |
|------|--------|
| **PERIODIC Job 規格（到期日 / 2614 互斥）** | `PLAN.md §11.6` |
| **Fee Commission 實作（三 Job / SubModule 分支）** | `FUNC_DESIGN/fee-commission.md` |
| **2614 廳主直發（UI / 停用確認窗）** | `FUNC_DESIGN/2614.md` + D67 / D63 情境四 |
| **0201 建代理 + 建 member（Q1 / Q4 實作）** | `FUNC_DESIGN/0201-agent-extraction.md` + D68 |
| **大廳代理佣金 12 API + 4 Tab** | `docs/func-design/website/lobby-agent-release/DESIGN.md` |
| **Trigger 哲學（B.1.Y / B.2.X / B.2.Y）** | `docs/guides/principles/trigger-philosophy.md` |
| **防禦性編程通則（業主自負責任 / 工具中性）** | `docs/guides/principles/defensive-programming.md` + D65 |
| **測試場景清單** | `docs/test-scenarios/agent-commission/` |
| **代理業務欄位缺口（realName / phone / ...）** | `FUNC_DESIGN/agent-business-fields-gap.md`（等業務 Q1~Q4）|
| **已決策不做清單** | `PLAN.md` 最下方「已決策不做（指向 DECISIONS）」|

---

## 已確認的規則

### D1：鎖定錢包是錢包模組的內部概念

外部不知道 locked 的存在。`getBalance` 不回傳 locked。withdrawable 就是 DB 裡的值（已扣除鎖定）。

代理不需要知道「有 3000 被鎖住」，只需要知道「提領單在審核中」。

### D2：撤銷發放 = 搬回待發放段

`revokeRelease` 是 `withdrawable → pendingRelease`。金錢搬移位置，不是消失。不做部分撤銷 — withdrawable 不夠就整筆 REJECT。

`releaseHistory` push 負數，歷史軌跡完整保留。

### D3：鎖定和 withdrawable 完全解耦

lockForWithdraw 扣完 withdrawable 後，withdrawable 就是「剩餘可自由操作的金額」。鎖定中的錢在另一張表，跟 withdrawable 的其他操作完全無關。

### D4：佣金明細是帳本，不是申請單

`commission_record` 是純事實記錄，無狀態欄位。「某時間，因為某注單，代理 X 應得 ¥270」— 事實，不可改。發放是操作錢包，不是逐筆審核明細。

### D5：不阻塞投注路徑

投注結算不做任何佣金操作。佣金由排程框架非同步掃描驅動（`commissionStatus=0`）。投注路徑零耦合，佣金失敗不影響投注。

### D6：每個業務獨立錢包 ❌ 已於 2026-04-14 被 D60 取代

D60「一個代理一種業務模型，只有一個錢包」— 原 D6 多錢包設計在發放時產生分配問題（5 錢包各自金額不同用哪個費率？）。詳見 D60。

### D7：佣金錢包歸錢包模組擁有

代理模組不碰錢包結構，不 import 錢包 Entity。只透過 `WalletForAgentCommissionFacade` 操作。

### D8：ownerId 是代理 ID

佣金錢包的 ownerId 存代理 ID（`sys_admin_user._id`），不是會員 ID。廳主也可能有佣金模式。

### D9：新 table 用 ObjectId

新建的 table 一律用正確的 ObjectId 型別，在 `OBJECT_ID_FIELDS` 宣告。

### D10：佣金錢包欄位命名

| 欄位 | 說明 |
|------|------|
| `pendingRelease` | 待發放（不叫 accumulated，避免跟歷史累計混淆）**可為負值**（負佣金時，原 D11 deficit 已合併進此欄位）|
| `withdrawable` | 可提領 |
| `totalWithdrawn` | 累計已提領 |
| `releaseHistory` | 發放/撤銷歷史（release push 正數，revoke push 負數）|

不變量：`sum(releaseHistory.amounts) = withdrawable + 鎖定中 + totalWithdrawn`

**deficit 欄位已移除**（2026-04 前後），原獨立虧損段併入 `pendingRelease` 負值。原 D11 同步廢止。

### D11：deficit 處理 ❌ 已於 2026-04 deficit 合併 pendingRelease 負值後廢止

新規則：`pendingRelease` 可為負值（原 deficit 語意），deposit 邏輯簡化為一行 `pendingRelease += amount`。詳見 D10 更新 + D60。

### D12：發放不做 plugin

所有發放最終都是同一個錢包操作（pendingRelease → withdrawable）。差異只在「誰觸發」— Admin service / Scheduler job / Lobby API。不需要子模組架構。

### D13：releaseHistory 對帳時間軸

代理對帳時，根據 releaseHistory 相鄰時間戳確定期間，查該期間的 commission_record。不需要「結算期數」table。

### D14：Facade 純委派

CommissionBusinessFacade 只做方法轉發，不做任何編排、DTO 組裝、邏輯判斷。曾經有 `buildBetSettlementEvent` 在 Facade 裡被發現並移除。

### D15：SubModule 自查自算

SubModule 收 `unknown` source，自行 cast + 注入 service 查資料 + 用 ConfigParser 取 config。Trigger 不傳代理鏈、不傳 config、不預載資料。

鎖的起始點在 SubModule 內：讀到代理立刻 `lockScope.acquireLock(LOCK_TYPE.AGENT_OPERATION, agentId)`。

### D16：Config 存在站點級獨立表

佣金設定存在 `sys_commission_site_config`，不存在廳主主檔的 `hallCommissionConfigs`。

理由：config 屬於「站點」不是「廳主帳號」。廳主可能經營多站點，各站點設定不同。

### D17：一 Trigger 一 Job

每種觸發類型對應一個 Job 子類。`CommissionSettlementJobBase` 提供共用邏輯，`BetSettlementJob` 是薄子類。不做「一個 Job 遍歷所有 Trigger」— 避免不同來源的掃描頻率和批次大小被綁在一起。

### D18：commissionStatus 三態

| 值 | 含義 |
|---|------|
| 0 UNPROCESSED | 未處理（排程會掃描）|
| 1 SETTLED | 已處理有佣金 |
| 2 SKIPPED | 已處理但跳過（不再掃描）|

區分「還沒處理」和「處理過但沒佣金」，避免無限重掃。

---

## 被否決的方案

### ❌ 事件 DTO（BetSettlementTriggerEvent）

早期設計讓 Trigger 組裝 event DTO（含 member、gameRecord、effectBet 等），傳給 SubModule。

否決理由：SubModule 自查自算更乾淨。不同子模組需要的資料不同，event DTO 要麼不斷膨脹，要麼變成 any。直接傳 source document 讓子模組自行取所需。

### ❌ CommissionParallelMode（ALWAYS/EXCLUSIVE）

早期設計讓子模組宣告「必定觸發」或「互斥觸發」，Trigger 在 runtime 判斷。

否決理由：互斥是 config 層面的問題（admin UI 不允許同時開衝突的業務），不是引擎 runtime 的問題。移除 ParallelMode，引擎只看 config 的 enabled 開關。

### ❌ hallCommissionConfigs 掛在廳主主檔

早期設計把佣金設定存在 `sys_admin_user.hallCommissionConfigs[]`。

否決理由：config 屬於站點不是帳號。改為 `sys_commission_config` 統一表。hallCommissionConfigs 欄位已從 Entity 移除。

### ❌ 三層覆蓋（plan → level → personal）

早期設計用 `sys_agent_commission_plan` 作為模版，`sys_agent_level` 作為中間層覆蓋，`agent.commissionOverride` 作為個人覆蓋。

否決理由：模版系統還沒想好怎麼做。先用站點級 config（`sys_commission_config`，configType=SITE），模版功能延到 Layer 3。模版將使用 `sys_commission_config`（configType=TEMPLATE）。`sys_agent_commission_plan` 舊表已刪除。

### ❌ 同步計算佣金（inline in bet settlement）

早期設計讓注單結算時同步呼叫佣金引擎。

否決理由：阻塞投注路徑。改為排程非同步掃描（`commissionStatus=0`），投注完全不碰佣金邏輯。

### ❌ EventQueueCache 事件佇列

考慮過用 Redis 佇列收集待處理事件。

否決理由：掃描模式更簡單（零耦合、自癒合、不丟事件），延遲可接受（分鐘級）。

### ❌ 雙 lockScope（注單鎖 + 代理鎖各自獨立）

早期設計用兩個獨立的 lockScope。

否決理由：違反「一個 scope 管所有鎖」的原則。改為多類型 `TransactionLockScope`（Factory 建立），一個 scope 持有 GAME_RECORD_COMMISSION + AGENT_OPERATION 兩種鎖。

### ❌ sys_agent_level 表

早期保留的舊架構代理等級表。

否決理由：跟 `sys_agent_commission_plan` 職責完全重疊。兩層覆蓋（plan → personal）夠用，不需要中間層。批量管理用後台批量操作功能。

### ❌ NGR 拆成多個 SubModule（每個觸發源各一個）

NGR 回應多種觸發事件（注單、手續費、優惠），考慮過拆成 5 個 SubModule 各自處理一種 triggerType。

否決理由：NGR 是一個業務模型，不是五個。拆開會導致 admin-2601 看到 5 個業務類型、config 註冊 5 次、前端渲染 5 個頁簽。改為一個 SubModule 支援多種 triggerType，內部按 triggerType 分支處理。

### D19：SubModule 支援多觸發類型（1:N）

**結論**：`getTriggerType()` 改為 `getSupportedTriggerTypes()`，回傳陣列。`calculate()` 加 `triggerType` 參數。

```
現在：  SubModule ←1:1→ TriggerType
改為：  SubModule ←1:N→ TriggerType
```

一個 SubModule = 一個業務 = 一份 config = 一個錢包 = 一個 admin 頁簽。內部按 triggerType switch 處理不同來源單據。

引擎註冊時，一個 SubModule 出現在多個 triggerType 的查詢結果中。

### D20：Config 統一表（sys_commission_config）

**結論**：合併 site / agent / template 三種 config 為一張表，用 `CommissionConfigType` enum（SITE/AGENT/TEMPLATE）區分。

- SITE：站點預設（admin-2601 管理）
- AGENT：代理個別覆蓋（整份替換，不做欄位 merge）
- TEMPLATE：模版（Layer 3）

所有佣金設定欄位收在佣金模組自己的表裡，不存 sys_admin_user。

### D21：佣金模組不讀其他模組的設定

**結論**：所有計算邏輯收斂在佣金業務模型和 config。不讀 `agent.profitRatio`、`agent.shareRatio` 等其他模組的欄位。

從 sys_admin_user 只查身份資料（name、parent、type），不讀不寫任何佣金相關設定。

### D22：精度規則（累積 / 發放 / 出金 三階段）

**結論**：系統存分（乘 100）。精度原則「累積保留小數，邊界取整」貫穿三階段：

| 階段 | 動作 | 取整方式 |
|------|------|---------|
| **計算佣金** | SubModule.calculate() | 保留小數（4 位數 = 分，6 位數 = 元）|
| **入累積段** | deposit → `pendingRelease` | **不取整**，保留精度 |
| **發放（release）** | `requestAmount = Math.floor(pendingRelease)` | **Math.floor 無條件捨去**，小數留累積段 |
| **扣項（override / cost）** | 計算過程 | 保留小數 |
| **入可提領段** | netAmount → `withdrawable` | 可為小數（累積） |
| **出金（transferToCenter / directWithdraw）** | 前端指定整數金額 | **此時才取整**（最外圍邊界）|

**為什麼分兩層取整（release + 出金）**：
- release 取整 → 累積段清零界線清楚（小數留累積等下次）
- 出金取整 → 代理實際拿到的錢必須是整數（業務需求）
- `withdrawable` 中間態可為小數，累積多次出金之剩餘不遺失

**為什麼用 Math.floor（無條件捨去）而不是 Math.round（四捨五入）**：
- floor 確保發出的金額**永遠 ≤ 累積段實際數字**，小數餘額留在累積段
- round 會在「.5 以上」時把**不存在的小數**發出去（例如 pendingRelease=10.6 → round=11，但累積段實際只有 10.6，多發的 0.4 憑空產生 = 超付事故）
- 超付會在帳本上產生「發出去的金額 > 累積」的異常 → 對帳失敗、業務事故
- floor 是**保守原則**：寧可少發（下次補），不可多發（無法追回）

原 D62「netAmount 精度」已整合至此表（出金階段）。避免逐筆取整的精度損失 + 避免超付 = 本條目中心思想。

### D23：業務模組互斥 ❌ 已由 D31（互斥群組）+ D60（一代理一業務）取代

原意仍有效但實作細節移動：
- **互斥機制**：D31 改為 SubModule 宣告 `getExclusiveGroup()`，REVENUE_SHARE 和 NGR_REVENUE_SHARE 同屬 `'REVENUE_MODEL'` 群組
- **一代理一業務**：D60 進一步把「configs[]」改為單一 `businessType + businessConfig`（不只同組不可並存，整體只能選一種）

### D24：設定內聚 — 所有參數收在 ConfigDto

**結論**：所有計算參數必須在業務模型的 ConfigDto（sys_commission_config）內。

不讀外部欄位：
- ❌ `agent.commissionState`（舊架構，不採用）
- ❌ `agentLevel.commission`（舊架構，不採用）
- ❌ `agent.profitRatio`（舊架構影響，RevenueShare 的差額遞迴是 bug）

未來 agent 指向 sys_commission_config 取參數。模版功能時加欄位指向 template。

### D25：即時結算（非月結）

**結論**：每筆注單結算後即時計算佣金入累積段。不做傳統月結。

理由：
- 代理即時看到累積數字 → 激勵拉下線
- 每筆獨立可追溯 → 可單筆重算，換代理不影響
- release + withdraw 自然形成週期，不需結算週期表
- 所有金額進出有 commission_record + wallet_trans_record 明細

報表需求以 date range 查詢解決，必要時加聚合摘要表。

### D26：FAVOUR_TRANSFER 按轉帳時間，非發放時間

**結論**：優惠/紅利的營運成本，以「優惠錢包→中心錢包」轉帳時間計算。

與業務規格（代理退佣結算.md）的差異：規格說「按發放時間」（3/31 發放算 3 月）。
我們按轉帳時間，因為：
- 所有優惠都進優惠錢包，玩家須達流水才能轉中心錢包
- 未兌現的紅利只是帳面數字，不是實際成本
- 只在「玩家真正領取獎勵」時才產生營運成本
- 不管什麼優惠類型（充值獎勵、任務、VIP、補償），統一卡控 FAVOUR_TRANSFER

### D27：上層代理不負擔子代虧損

**結論**：上層代理在子代 release 時才計算 overrideRate 佣金。子代 deficit 期間上層不受影響。

理由：
- 激勵代理發展下線（不會因下線虧損而減少收入）
- 提現時計算來源單一（只看 release 金額）
- 設計保留：未來可能支援上層共負盈虧

### D28：RevenueShare profitRatio 差額遞迴是 bug

**結論**：RevenueShare SubModule 實作時被舊系統影響，加入了 profitRatio 差額遞迴邏輯。原設計沒有此邏輯。

RevenueShare 目前已暫停（被打回），暫不修。待重新啟用時需移除差額遞迴。

### D29：FAVOUR_TRANSFER 用 sys_member_reward_log 作為觸發源

**結論**：優惠錢包→中心錢包時，錢包模組寫入 `sys_member_reward_log`。佣金 Job 掃描此表。

不直接掃描 `wallet_trans_record`，因為：
- wallet_trans_record 是通用交易記錄，加 commissionStatus 會污染
- 職責邊界：錢包模組只寫 memberId、金額、來源（它知道的）
- memberName、parent（代理）由佣金 SubModule 計算時自查（D15）

表結構：memberId + rewardType + amount + forfeitedAmount + sourceId + website + currency + commissionStatus

### D30：代理佣金提領單

**結論**：所有 pendingRelease → withdrawable 都經由「代理佣金提領單」。

產生途徑：
- 代理申請 / 直接提領（大廳功能）
- 廳主直接派發（後台 admin-2607）
- 系統自動產生（排程 Job，PERIODIC 模式）

提領單走審核流程（建單 → 待審核 → 通過 → 執行 release）。

附帶好處：
- AGENT_OVERRIDE 掃描已通過的提領單（不需特殊架構）
- 週期結算 = 排程在約定時間自動建單 → 走同一套審核流程
- 廳主可隨時派發、可約定時間、可特殊處理

### D31：互斥群組（exclusiveGroup）

**結論**：SubModule 聲明互斥群組，同組只能啟用一個。

模仿優惠子模組 `implGetParallelMode()` 模式。CommissionSubModuleRoot 新增：
```typescript
getExclusiveGroup(): string | null { return null; }
```

REVENUE_SHARE 和 NGR_REVENUE_SHARE 同屬 `'REVENUE_MODEL'` 群組。
admin-2601 save 時驗證 + findById 回傳 exclusiveGroup 給前端渲染。

### D32：營運成本改到發放時扣

**結論**：NGR SubModule 的 calculate() 不扣營運成本（venueFeeRate、adminFeeRate），統一公式為 `loseAmount * betCommissionRate%`。

營運成本在 release 階段（提領單審核時）才扣除。

理由：
- calculate 階段只管「代理應得比例」，營運成本是平台層面的扣項
- 累積段（pendingRelease）保留原始佣金，對帳清楚
- 發放時統一扣，避免 calculate 和 release 兩處都扣營運成本

---

### D33：取消站點 fallback — commissionConfigMode 必須明確

**結論**：代理必須有明確的 commissionConfigMode（CUSTOM / TEMPLATE / TIER）。
mode=null → 結算時跳過 + 系統警告。不 fallback 站點 config。

2601 的角色從「runtime fallback」改為「新進代理的分傭預設值」。
預設值存在 `sys_website_config.defaultCommissionConfig`，建代理時複製到代理身上。

理由：
- 分傭設定必須是「有意識的挑選」（有人背書）
- 隱式 fallback 容易出錯（改站點設定意外影響所有代理）
- 每個代理的佣金計算來源必須可追溯

### D34：disabled 是 config 層級，不是 agent mode

**結論**：「不分傭」用 CommissionConfigSetDto.disabled=true 表達，不是 agent 的 mode。

sys_admin_user.commissionConfigMode 只有三個值 + null：
- CUSTOM / TEMPLATE / TIER / null
- 沒有 'NONE'

disabled 在每個層級都用同一結構：
- 站點預設 disabled=true → 用此預設的新代理都不分傭
- 模版 disabled=true → 「不分傭模版」，改模版 → 連結代理同步
- 自訂 disabled=true → 代理自己選不分傭
- 晉升階級 disabled=true → 某個等級不分傭

理由：
- 模版同步 — 改模版 disabled → 所有連結代理同步生效
- 語意一致 — 所有層級用同一個欄位表達同一件事

### D35：TIER 業務模型不連結模版

**結論**：晉升方案的每個階級有自己獨立的 config 記錄（configType=TIER_LEVEL），不引用模版。

理由：
- 廳主設計晉升方案時應全盤考慮（逐階級設定）
- 模版被多處引用，調整時有 side effect，太危險

### D36：AGENT_OVERRIDE 級聯分傭，不做排程

**結論**：上層代理抽成在提領單通過/派發時同步計算，不另開 Job 掃描。

級聯規則：
- 第一層從 requestAmount 算（申請人的 overrideRate）
- 第二層從第一層 grossAmount 算（上一層代理的 overrideRate）
- 以此類推直到廳主或 overrideRate=0
- 申請人只被扣第一層 gross

理由：
- 提領單量不多，不需排程
- 同一交易內完成，好 debug
- 分兩段（排程掃描）增加複雜度和一致性風險

### D37：提領單鎖定機制

**結論**：申請時 lockForRelease（累積段 → 鎖定），審核時 confirmRelease/cancelRelease。
多張提領單可並存，各自獨立鎖定。

廳主派發（dispatchRelease）不經鎖定——lock + confirm 在同一交易內，或直接操作。

### D38：保級門檻（非降級條件）

**結論**：語意為「連續 X 期未達成門檻 → 降一級」。
門檻用 >= 閾值表達，未達成才觸發降級。

settle_time > tier_updateAt：防止晉升後用舊數據立刻降級。

### D39：resolveConfig 公用化

**結論**：三處 resolveConfig（NGR SubModule、RevenueShare SubModule、提領單）的 switch(mode) 邏輯抽成公用。

- CommissionConfigResolverService（佣金模組內部 injectable）
- CommissionBusinessFacade.resolveConfig(agent, businessType) 對外

內部 SubModule 直接用 resolver，外部模組透過 Facade。

### D40：CommissionConfigModeSelector 獨立元件

**結論**：分傭設定模式選擇器是獨立元件（和 CommissionConfigEditor 分開）。

- 負責模式選擇（CUSTOM / TEMPLATE / TIER）+ 對應子 UI
- CUSTOM → 展開 CommissionConfigEditor
- TEMPLATE → 模版下拉 + readonly 顯示
- TIER → 方案下拉 + 階級下拉

用於 2604（站點預設值）、2611（代理設定）、2612（申請審核）。

元件只做 UI 選擇，不做 DB 操作。getConfig() 回傳 CommissionModeConfig，呼叫端負責建立/更新 DB 記錄。

---

## 2026-04-13 新增決策

### D41：移除 configType=SITE

**結論**：CommissionConfigType.SITE 從 enum 移除。sys_commission_config 中 configType=SITE 的記錄將被清理。

理由：
- D33 取消了 runtime fallback → SITE config 不再被引擎讀取
- 2604 的 defaultCommissionConfig 取代了「站點級預設值」的功能
- 保留 SITE config 造成操作人員混淆（「我設了站點佣金設定為什麼代理不生效」）

### D42：2601 退場，2604 接手

**結論**：admin-2601 待廢除，由 admin-2604 取代。

- 2604 驗證通過後執行移除
- 2604 全新開發，不改建 2601（避免 session 只做小範圍調整遺漏設計）
- 業主操作順序：先建模版（2602）和晉升方案（2603），再設站點預設（2604）

### D43：consecutiveCount 移至 conditionSet 層級

**結論**：TierConditionRule 不再各自有 consecutiveCount，統一由 TierConditionSet 定義。

理由：
- 各 rule 不同 consecutiveCount → 評估窗口不一致，實作複雜且語意不明
- 統一後所有 rules 在相同的時間窗口內判斷，AND 邏輯清晰
- UI 更直觀：「計算週期 [月] 連續達成 [3] 次」是一句完整的描述

### D44：模版異動記錄

**結論**：新增 sys_commission_template_log 表，記錄模版的 CREATE/UPDATE/DELETE。

- save/delete 成功後寫 log（before/after 快照 + 連結代理數）
- findById 回傳 linkedAgentCount，前端顯示修改影響範圍警告
- 不做即時通知，audit trail 優先

### D45：2612 審核阻擋

**結論**：2612 代理申請審核時，站點未設定 defaultCommissionConfig → 阻擋審核。

理由：
- 客服不可調整分傭設定（readonly）
- 沒有預設值就無法決定代理的分傭模式
- 明確阻擋比靜默跳過更安全

### D46：2604 使用專屬 pageList API

**結論**：2604 列表頁自建 pageList API，不複用 websiteCascadeOptions。

理由：
- websiteCascadeOptions 包含 agents/gameStores/gameCategories，2604 不需要
- 2604 需要 defaultCommissionConfig 狀態，websiteCascadeOptions 不包含
- 站點數量少，一次查 sys_website_config 即可

### D47：override 級聯不存在死鎖風險

**結論**：TransactionLockScope 的平行鎖機制（用到時加鎖，容器一起釋放）+ 單方向由下往上遍歷 = 不可能產生循環等待。

分析：
- C 的 override 鎖 {C, B, A}（下→上）
- B 的 override 鎖 {B, A}（下→上）
- B 不需要 C 的鎖，不存在循環依賴
- 最多是 contention（等前一筆完成），自然解決

### D48：systemRestrictions 放在 CommissionConfigSetDto

**結論**：系統功能限制（提款開關、提款限額）放在 CommissionConfigSetDto 層級，和 disabled / configs 並列。

結構：
```typescript
class CommissionConfigSetDto {
  disabled: boolean;
  configs: CommissionConfigItemDto[];
  systemRestrictions?: SystemRestrictionsDto;
}
```

跟著 config 走 = 改模版同步、升級自動換限制。

限制項目（v1）：
- canWithdraw：是否可提款
- hasWithdrawLimit：是否有限制
- withdrawLimits：每日限額(USD)、每日次數、單筆最低(USD)、單筆最高(USD)

每個限制項有獨立 enabled 開關。金額統一 USD（和 tier 條件一致）。

**不含**銀行卡/電子錢包繫結開關：
- 銀行卡：提款必要條件，無限制意義
- 電子錢包：提供轉中心錢包功能，預設一倍流水，不需限制

舊 sys_agent_level 的 withdraw / withdrawConfig / bank / wallet 欄位不遷移，代理提款功能全面重新設計。

### D49：代理提款為獨立大項目

**結論**：代理提款流程（申請 → 限制檢查 → 審核 → 付款）是一個需要完整設計的獨立項目。

- 放棄舊 agent_level 的提款邏輯，全部重新設計
- 提款限制從 commission config 的 systemRestrictions 讀取
- 透過 CommissionConfigBusinessFacade 解析（和佣金計算用同一條路）
- 舊 website-withdraw.service.ts 中 type=2 的代理提款邏輯需要重寫

### D50：CommissionConfigBusinessFacade — config 的唯一入口

**結論**：新建 CommissionConfigBusinessFacade，封裝所有 CommissionConfigSetDto 的生命週期操作。

職責：
- 驗證 + 正規化（validateAndNormalize）
- 模版 CRUD（2602 用）
- 站點預設 CRUD（2604 用）
- 代理 config CRUD（2611 用）
- 階級 config CRUD（2603 用）
- config 解析（引擎 + 提領單用）
- editor 查詢資料（sys-component 用）

不管：agent entity 更新（2611 自己處理）、佣金計算、錢包操作、提領單。

**所有需要存取 sys_commission_config 的模組，必須透過此 facade，不可直接 import SysCommissionConfigService。**

**直接注入 SysCommissionConfigService 會繞過以下重要機制**：
- `validateAndNormalize` 驗證（TEMPLATE 存在？TIER 啟用？rank 合法？同站點？）→ 髒資料寫入 DB
- `sys_commission_template_log` 模版異動記錄（D44）→ audit trail 斷鏈
- `resolveConfig` 模式解析邏輯（mode=null 警告、disabled 檢查）→ 結算邏輯不一致
- ModeSelector 讀寫對稱（pointer / agent 更新）→ UI 和 DB 狀態錯位

CommissionBusinessFacade.resolveConfig() 改為委派給 ConfigBusinessFacade.resolveConfig()。

### D51：站點預設 CUSTOM config 存 sys_commission_config(DEFAULT)

**結論**：sys_website_config.defaultCommissionConfig 只存指標，不存 CommissionConfigSetDto。

CUSTOM 模式的實際 config 存在 sys_commission_config(configType=DEFAULT, websiteId)。

```
sys_website_config.defaultCommissionConfig = {
  configMode: 'CUSTOM' | 'TEMPLATE' | 'TIER',
  configId?: string,        // CUSTOM → sys_commission_config(DEFAULT)._id
  templateId?: string,      // TEMPLATE
  tierPlanId?: string,      // TIER
  tierInitialRank?: number, // TIER
}
```

理由：
- 所有 CommissionConfigSetDto 統一在 sys_commission_config，facade 統一處理
- sys_website_config 不存業務模型細節，只存指標
- validateAndNormalize 只需處理一張表

### D60：一個代理一種業務模型

**結論**：CommissionConfigSetDto 的 `configs: CommissionConfigItemDto[]` 改為 `businessType: string` + `businessConfig: Record`。一個代理只能啟用一種業務模型。

**影響**：
- CommissionConfigSetDto：`configs[]` 移除，改為 `businessType` + `businessConfig`
- 佣金錢包（agent_commission_wallet）：移除 `businessType`，唯一索引改為 `{ ownerId }` unique
- 鎖定錢包（agent_commission_locked_wallet）：移除 `businessType`
- 提領單（agent_commission_release_order）：移除 `businessType`
- CommissionConfigParser：改讀 `businessType` + `businessConfig`（不再遍歷陣列）
- validateAndNormalize：移除互斥群組驗證，改為驗證 `businessType` 已在 Registry 註冊
- 前端 CommissionConfigEditor：Tab+Toggle → 下拉選單

**理由**：
- 多錢包（按業務分）在提領時產生分配問題（5 個錢包各自金額不同，用哪個費率？）
- 業務模型的扣項（營運成本、階段式激勵等）在發放時才計算，需要知道業務類型
- 業務互斥（D31）已限制同群組不可並存，D60 更進一步：整體只能一種
- 簡化全鏈路：佣金計算 → 錢包 → 提領 → 提款

**遷移**：既有 DB 記錄（configs[]）需清理或轉換。舊格式的 CommissionConfigItemDto 保留供遷移參考（@deprecated）。

---

## 2026-04-16 新增決策

### D61：代理軟刪除後佣金餘額處理（D-2 解決）

**結論**：不需新機制。現有工具足夠：
- 2614 廳主直接發放（累積段 → 可提領段）
- 2622 線下結清（可提領段 → 已提款標記）
- transferToCenter（可提領段 → 中心錢包）

2611 softDelete 加餘額提示：如果代理有 pendingRelease > 0 或 withdrawable > 0，回傳警告訊息。
前端確認後帶 `ignoreBalance=true` 重新送出即可刪除。

理由：
- 軟刪除後代理不能登入大廳，不能自己提款
- 但佣金餘額是代理的，不能靜默丟失
- 廳主/管理員有足夠工具在刪除前處理餘額
- 加提示而非硬擋，保留操作彈性（例如金額極小不值得處理）

### D62：netAmount 精度 ❌ 已於 2026-04-19 併入 D22「精度規則」

精度三階段（計算 / 發放 / 出金）統一於 D22 表格呈現。本條目保留殼以利舊引用。

### D63：代理停用/軟刪除時的佣金處理（整合 2026-04-19，吸收原 D66）

> **2026-04-22 擴充**：本條所有「status 異常」規則同樣適用於 `freeze=1`（凍結）。三態（停用 / 凍結 / 軟刪）對自動路徑規則**完全一致**，差別只在下線 cascade 與業主意圖。詳見 **D69**。

**業務精神（貫穿以下所有情境）**：消失的份額 = **業主扣項減少（不是業主多拿一筆錢）**。玩家本來就在業主平台投注，中間抽成的人消失 → 業主「要付給代理體系的佣金支出」變少 → 盈餘提升。詳見 D65 §一業務角色框架。

---

#### 情境一：源頭代理停用，新注單進入結算（自動路徑）

- **時機**：注單 / Fee 單由排程 Job 掃到，進入 NGR SubModule.checkApplicable
- **判斷**：會員 → member.parent → 代理，檢查 agent.status
  - status=1（停用）/ status=2（軟刪除）→ **不寫 ledger、不動 wallet**
  - source 標 `CommissionProcessingStatus.SKIPPED = 2`
- **實作位置**：NGR SubModule + Fee Commission 三個 SubModule（RechargeFeeJob / CompanyDepositFeeJob / WithdrawalFeeJob）

#### 情境二：發放時 override chain 中遇停用代理（自動路徑）

**方向約定（避免 README 與本段字母混淆）**：

```
        HALL               ← 最頂（business owner 的終點，不拿 override）
         │
         ↑  override 往上爬
         │
       parent C            ← 中間層
         │
         ↑
         │
       parent B (停用)     ← 中間層，可能停用
         │
         ↑
         │
releasing agent A          ← 發起 release 的人（chain 起點）
```

**統一口徑**：「A 發起 release」 = **A 在最下**，parent 鏈往上。本文件與 business-flow-diagram §4.4 一致。
（README §六用反向字母「HALL → A → B → C，C release」 — 計算公式等價，只是字母方向不同，數字上可對照）

---

發放者 A，parent 鏈 A → B → C，**B 停用**，各 overrideRate=10%，A release 100：

```
A.grossOverride = 100 × 10% = 10        (A 被扣給 chain 的總額)
A.netAmount    = 100 - 10 = 90           (A 實拿)

爬到 B：B.gross = 10，B.overrideRate=10%
  parentTake = 10 × 10% = 1 (送去 C)
  B.deposit  = 10 - 1 = 9

爬到 C：parent=HALL → chain 終止
  C.deposit = 1

正常：A 拿 90、B 拿 9、C 拿 1
B 停用：A 拿 90（不變，A 被扣 10 照扣）、B = 0（entry 不寫）、C 拿 1（不變）
B 原本的 9 消失 = 業主利潤
```

**規則**：
- `calculateOverrideChain` 遇 status 異常（1/2）上層 → **該層 entry 不寫**（不進任何錢包）
- 其他層按原公式算，`remaining / currentAgent / level` 正常推進
- **不重分**給上或下層、**不回頭補算**（簡化邊界）

**實作位置**：`agent-commission-release-order-internal.service.ts` 的 `calculateOverrideChain`（現況只擋 `type === HALL`，要加 status 檢查於行 769 / 793 兩處）

**實作提示**：只改 push entry 行為（跳過停用那筆），basisAmount / remaining / overrideRate 計算鏈一律不動。不需為保持數字「不變」而重算。

**業主報表呈現（消失份額不獨立顯示）**：

消失的 override 份額**不在任何報表設立獨立欄位**。業主透過以下方式「間接感知」：

| 報表 | 呈現方式 |
|------|---------|
| admin-2621 代理佣金明細 | 停用代理的 ledger 該筆 entry **根本不存在**（和一般「未曾分傭」沒區別，無法分辨是「從未參與」還是「停用消失」） |
| admin-2622 代理金流摘要 | 該站點當期「代理佣金總支出（發放金額 − override 入帳）」自然變少 |
| release order 明細 | `requestAmount=100 / totalOverride=10 / 實際 ledger 寫入總和 < 10` — 差額等於消失份額，但**系統不顯示「差額欄位」** |

**為何不設獨立欄位**（D65 精神）：
- 業主的收益結構 = 進項 − 扣項，**業主只看扣項總額是否合理**，不看單筆的「本來應該支付多少」
- 若呈現「B 消失了 9」會誤導業主以為「B 被系統拿走」，實則是「B 不存在所以 A 不用付那 9」
- 想追溯消失份額 → 用「該代理的狀態 log」+「同期 release 明細」人工對照（系統不主動追溯）

**設計邊界**：若業主反映「看不到誰的佣金消失了」→ 未來可在 2622 加「停用代理佔比指標」，但目前**不做**（行業特性，業主習慣線下對帳，D65）。

#### 情境三：代理軟刪除後 withdrawable 仍有餘額

見 **D61**（2614 廳主直接發放 / 2622 線下結清 / transferToCenter 三工具足夠，不需新機制）。

#### 情境四：廳主用 2614 直發給已停用代理（業主路徑）

業主可能線下付款後要扣代理錢包 → 允許操作（Facade 不擋），UI 前置確認窗提醒「此代理已停用」。詳見 D67 業主路徑規則 + `FUNC_DESIGN/2614.md`。

---

#### 恢復處理（貫穿情境一、二）

- 業主**直接改 DB**（mongosh）把 SKIPPED 的 commissionStatus 從 2 改回 0
- 排程下次自然重掃 → 重結算（用**當下**的 agent config，不做歷史 snapshot）
- **系統不做管理 UI**（行業特性不需這種精度，業主自助即可，見 D65）
- **override chain 的消失份額不補**（情境二 B 的 9 不回頭補）

#### 業主想完整補給代理

**不經系統重算**，走線下：
- 後台人工加扣款
- 代理錢包線下結清（offlineSettle）
- 直接轉錢

#### 已否決（不做）

- 批次重算 / 預估試算 / 歷史 config 快照
- 後台 SKIPPED 注單批次改 UI
- 暫止錢包（停用代理那份 override 暫存等恢復）
- 自動補算歷史 release 的 override
- 智慧重分配（給上層 / 給下層）

**否決原因**：行業特性不需這種精度（D65）。人工改狀態 + 排程自然重跑 + 線下平帳已夠用。

**防禦精神**：見 D65。原 D66 完整內容已併入本條目，D66 保留殼指向此處。

### D64：apply configBasis 樂觀鎖

**結論**：preview 回傳 configBasis（retentionRate / costRate / overrideRate / minReleaseAmountUsd），apply 原封帶回。後端比對目前 config，不一致 → 拒絕「分傭設定已變更，請重新申請」。結算永遠用目前後端值。

同時在 apply 補上 minReleaseAmountUsd 後端驗證（preview 有擋，apply 也必須擋）。

### D65：行業脈絡 — 業務角色框架 + 防禦性編程精神（2026-04-19）

#### 一、業務角色框架（理解所有決策的前提）

三角色職責邊界：

| 角色 | 職責 | 收入 / 支出結構 |
|------|------|--------------|
| **平台營運商** | 維運系統（server/網域）；接恰遊戲商/支付商並付費；和業主談商務條件 | 收入 = 業主交租金 / 約定投注量分潤 → **線下談，系統看不到** |
| **業主**（HALL）| 租平台、招商、營運 | **進項**：玩家注單輸錢<br>**扣項**：代理佣金（注單佣金 + override + fee）、付平台租金、營運成本<br>**盈餘 = 進項 − 扣項**（業主自己對報表算） |
| **代理**（AGENT）| 招募玩家下注、領取佣金 | 佣金累積段 → 發放 → 可提款 |

**關鍵推論（影響多個決策）**：
- 業主不需要知道每筆 override 去哪了；業主只看「這個月付了多少佣金」= 扣項
- 系統的「消失歸業主利潤」= 扣項變少 = 盈餘多一點（不是業主多拿一筆錢）
- 業主不拿 override（HALL 結束 chain），因為業主的收益 = 注單進項本身
- 平台營運商和系統業務無關（不在系統資料內）

#### 二、防禦性編程精神

**結論**：博奕業不像銀行業強求「每筆錢清清楚楚」。線下作業是常態，系統給工具讓業主平帳，而不是反向限制業主能做什麼。

**兩類路徑的分層處理**：

| 路徑 | 性質 | 對異常的態度 |
|------|------|-------------|
| **自動路徑** | Job / Trigger / 排程 / 大廳登入層 | **嚴格擋** — 錯誤會自動放大，必須源頭防 |
| **業主路徑** | Admin API / 後台操作 | **不擋** — 業主明知異常還要操作 = 要平線下帳 |

**Facade 層工具中性**：WalletForAgentCommissionFacade / AgentLedgerDomainFacade 不判斷「該不該操作」，只做「怎麼操作」。檢查責任上推到 Controller / Job 入口，讓業主和自動路徑共用 Facade、各自決定嚴格度。

**完整原則**：`docs/guides/principles/defensive-programming.md`（含行業對比、反模式、決策準則）

#### 三、在代理佣金的具體落地

| 決策 | 應用 |
|------|------|
| D63 停用/恢復處理 | 自動擋 + 業主改 DB 狀態 / 不做 UI / 消失歸業主 |
| D67 status 源頭鎖 | 三類路徑分層（自動嚴 / 當事人嚴 / 業主鬆）|
| 線下平帳工具 | 人工加扣款、`dispatchRelease`、`offlineSettle`、`transferToCenter`、SKIPPED 狀態 DB 改 |

#### 四、不做

- 強制業主「做 A 必先做 B」的流程（例：註銷前必先清餘額）
- 自動補算歷史資料
- 追求每筆可 100% 重現的精度（snapshot / 版本控制）
- 強加形式化稽核（上傳憑證、分類理由）於線下操作

### D66：RELEASE override 遇停用代理 ❌ 已於 2026-04-19 併入 D63「情境二」

完整場景、規則、實作位置見 D63 情境二段。本條目保留殼以利舊引用。

### D67：代理 status 源頭鎖 — 分三類路徑處理（2026-04-19 新增）

> **2026-04-22 擴充**：本條「status 異常」涵蓋範圍擴大為 `status=1 (停用)` OR `freeze=1 (凍結)` OR `status=2 (軟刪)`。自動路徑 / 當事人路徑檢查條件應三態一起檢；業主路徑仍三態都不擋。詳見 **D69**。

**結論**：代理 status 異常（停用 / 軟刪除）時的存取規則分**三類**。

**自動路徑 — 嚴格擋**：
- NGR SubModule.checkApplicable — ✓ D63 已加
- Fee Commission 三個 SubModule — ✓ 設計已含（`fee-commission.md`）
- `calculateOverrideChain`（RELEASE override）— D66 要加
- PERIODIC Job — 不自動建單給異常代理

**當事人（代理本人）路徑 — 嚴格擋**（大廳）：
- 大廳登入層 — 異常代理禁止登入
- 大廳代理佣金 API（申請 release / 提款 / 轉中心 / 查餘額 / 看看板 / 推廣連結 / ...）— 即使 token 還有效，操作時重驗 agent.status
- 理由：代理停用 = 業主已決定「這代理不該再動系統」。代理本人自己操作等於**繞過業主決定**

**業主路徑 — 不擋**：
- `dispatchRelease` / `offlineSettle` / `transferToCenter` / `revokeRelease` — 都允許對異常代理操作
- 2611 pageList / 2621 流水帳 / 2622 摘要 — 可查異常代理的歷史
- 業主能線下平帳（符合 D65）
- 即使業主「沒注意到代理已停用」— 業主本來就該掌握自己的代理狀況，系統不幫補

**Facade 層中性**：
- `WalletForAgentCommissionFacade` 各方法**不加** status 檢查
- `AgentLedgerDomainFacade.buildEntryOp` **不加** status 檢查
- 判斷「該不該操作」的責任上推到 Controller / Job / 排程入口

**為何業主不擋、代理本人要擋（關鍵差異）**：
- 代理本人路徑：**當事人主動** — 停用後不該能自己碰系統，否則業主的管理決定形同虛設
- 業主路徑：**第三人代為處置** — 業主是代理的上級管理者，有權處置代理的任何狀態

**讀操作一律允許**（即使 status 異常）：
- 管理需求：業主要看歷史才能決策怎麼處理
- 報表需求：2611 / 2621 / 2622 都必須能呈現異常代理的過往資料

**不做**：
- 業主操作路徑的 status 檢查
- 強制「註銷前清餘額」的流程
- Facade 層加「跳過 status 檢查」的參數（切層乾淨就不需要開關）

### D68：代理-member 帳號連動規則（2026-04-19 新增）

> **2026-04-22 擴充**：狀態連動新增 `freeze=1` 規則（paired member 也連動停用）。cascade 下線的語意收在 **D69**（本條只管 paired member 本身）。

**結論**：**一個代理 = 一個代理帳號 (sys_admin_user) + 一個對應會員帳號 (sys_member)**，兩者在生命週期、狀態、密碼上連動。

**建立**：
- 建代理時**同步建對應 member**（`AgentCreationService.create` 內完成）
- 一代理一幣別 → 一 member；廳主 child[] 多幣別 → 多代理多 member（每幣一對）
- 命名規則：代理名 = 對應 member 名（同名）
- 密碼：**自動建的 member 密碼 = 代理密碼**（業主只需記一組）
- 已存在的 member（會員轉代理路徑）→ 不重建，既有 member 當對應 member

**兩條來源路徑**：
| 路徑 | member 來源 | 建代理時的 member 處理 |
|------|-----------|--------------------|
| 會員申請轉代理（2612 審核）| **沿用既有 member**（繼續保留一般狀態）| 不建新 member；member 身份仍可下注 / 提款 |
| 後台建代理（2611 / 2614 / 0201 child[]）| **自動建新 member**（停用狀態）| 僅作代理錢包提款路徑的載體，本身不下注 |

**為何會員轉代理後 member 保留**（B-1 決策）：
代理要用提款模組（轉中心錢包 / 直接提款）→ 提款模組設計對象是 member → 需要活著的 member 當流程載體。若轉代理時把 member 停用 → 代理無法提款。

**狀態連動**（B-2 / B-3 決策 + 2026-04-22 擴充）：
| 代理狀態變更 | 對應 paired member 狀態 | 理由 |
|-----------|----------------|------|
| 代理停用（status=1）| **連動停用** | 防止錢從 member 側被領出繞過代理停用限制 |
| 代理凍結（freeze=1，2026-04-22）| **連動停用** | 凍結也擋 paired member（避免代理透過本人 member 帳號繞過凍結提款）|
| 代理軟刪除（status=2）| **停用（不刪除）** | 業主可能還要線下結清，提款路徑仍需 member 當載體 |
| 代理恢復（解凍 / 解停）| member 回復前狀態 | 需紀錄停用前狀態以便恢復（實作細節）|

> **下線 cascade 規則**（停用才 cascade、凍結/軟刪不 cascade）見 **D69**。本表只管代理自己和 paired member。

**命名衝突處理**：
- 代理名和**自動配對的 member** 允許同名 ✓
- 既有 member 和**新建代理**撞名 → 擋（視為外部衝突，要求改名或綁定走轉代理路徑）
- 廳主 child[] 多幣別同名 member → **允許**（同站同名，不同幣不衝突；一代理一幣 = 一 member）

**防禦性**（對接 D65 / D67）：
- 如果對應 member 意外不存在（資料損壞、人工誤刪）— **不做主動防禦**，讓流程自然失敗讓業主察覺；符合「業主自負責任」精神
- 提款 / 轉中心遇 null → 回傳明確錯誤即可，不做補救建 member

**實作位置**：
- 建立：`AgentCreationService.create`（B 路徑加自動建 member 邏輯）
- 狀態連動：`admin-2611` 的 toggleStatus / delete → 同時更新對應 member 狀態
- 連動錨點：代理 entity 的 `member` 欄位指向 `sys_member._id`（同步建立時寫入）

**不做**：
- 對應 member 獨立改狀態的 UI（業主不該從 member 端動代理的對應帳號；所有操作走代理 entry）
- 多幣別代理共用一個 member（一幣一代理一 member，不合併）
- 對應 member 密碼獨立設定介面（同代理密碼即可）

---

### D69：凍結狀態與下線 cascade 規則（2026-04-22 新增）

**結論**：恢復 `sys_admin_user.freeze` 欄位的業務用途。三種代理異常狀態（停用 / 凍結 / 軟刪）對代理本人、paired member、佣金結算、override chain、業主路徑的規則**完全一致**，差別**只在是否 cascade 下線子樹**。

#### 一、三態規則對比

| # | 層 | 停用 status=1 | 凍結 freeze=1 | 軟刪 status=2 |
|---|---|---|---|---|
| 1 | 代理本人當事人路徑（登入 / 提款 / 申請 / 轉中心）| 全擋 | **全擋**（同停用）| 全擋 |
| 2 | paired member 連動（D68）| 連動停用 | **連動停用**（同停用）| 連動停用（保留當提款載體 D68）|
| 3 | 佣金結算 checkApplicable（NGR / Fee / FAVOUR）| SKIPPED | **SKIPPED**（同停用）| SKIPPED |
| 4 | Override chain 該層（D63 情境二）| 截留消失 | **截留消失**（同停用）| 截留消失 |
| 5 | 業主後台路徑（2614 / offlineSettle / transferToCenter / pageList）| 可操作 | **可操作**（同停用）| 可操作（D61 清帳工具）|
| 6 | **下線代理 + 下線會員 cascade** | **整棵子樹連動停用** | **不 cascade**（下游照玩）| **不 cascade**（保留清帳空間）|

#### 二、語意定位（為何需要三態）

| 狀態 | 語意 | 適用情境 |
|------|------|---------|
| 凍結 | 關代理本人、業務流繼續 | 調查中、帳號疑似被盜、合約調整期 |
| 停用 | 解雇代理 + 遣散子樹 | 業主下決心終結代理關係，接受下線收入損失 |
| 軟刪 | 終結關係 + 保留清帳空間 | 代理離場後業主還要用線下工具清餘額 |

#### 三、Cascade 規則（僅停用適用）

停用代理 X 時：
- **遞迴 cascade 整棵子樹**：X 的所有子代理（含孫、曾孫...）status=1
- X 下所有下線會員（含子代理底下的）也連動停用
- 每個 cascade 到的代理 → 其 paired member 也連動停用（走 D68 規則）
- **實作需 transaction**：cascade 過程中任何失敗 → 整批 rollback（避免半套狀態）

**為何停用才 cascade，凍結/軟刪不 cascade**：
- 停用業務意圖 = 徹底終結這個代理分支 → 連帶整棵子樹全關，避免子代理 / 會員「掛在死代理下但還能活動」的孤兒狀態
- 凍結業務意圖 = 保留業務流 → 下游不受影響繼續帶收入
- 軟刪業務意圖 = 清帳期 → 若下游都停，代理本人的錢也無法透過下游結清（違反 D61 三工具精神）

#### 四、恢復機制（對齊 D63 精神，不做 UI）

| 解除動作 | 做法 |
|---------|------|
| 解凍（freeze=1 → 0）| 業主改 DB。commissionStatus SKIPPED=2 → 0 讓排程重掃 |
| 解停（status=1 → 0）| 業主改 DB。**子樹恢復需業主逐筆自助處理**（系統不提供整樹恢復工具）|
| 軟刪恢復（status=2 → 0）| 業主改 DB。極邊角，業務上「代理離場後又回來」罕見 |

- 重算佣金：**用當下 config**（不保留歷史 config snapshot）
- 消失的 override 份額**不回頭補**（對齊 D63 恢復處理）

#### 五、實作範圍（N1 + N2 對應）

- **N1 狀態連動實作**（`admin-2611.service.ts`）：
  - `toggleStatus`（status=1）→ 加 paired member 連動停用 + 子樹 cascade（含子代理 / 下線會員）
  - `softDelete`（status=2）→ 加 paired member 連動停用（不 cascade 下線，見上方「軟刪」列）
  - **新增** `toggleFreeze`（freeze=1/0）→ 加 paired member 連動停用（不 cascade 下線）
  - 所有動作用 transaction 保證 rollback
- **N2 override chain 停擋實作**（`calculateOverrideChain`，`agent-commission-release-order-internal.service.ts`）：
  - 條件擴大為 `status IN (1, 2) OR freeze = 1` → 該層 entry 不寫（D63 情境二）
  - 實作位置：現況 line 770 / 794 只檢 `type===HALL`，要加 status + freeze 檢查
- **SubModule.checkApplicable**（NGR / Fee / FAVOUR）：
  - 條件同 N2 擴大，遇異常 → commissionStatus=SKIPPED=2
- **當事人路徑檢查**（大廳登入 + 代理佣金 API）：
  - agent.status OR agent.freeze 任一異常 → 擋

#### 六、歷史記錄

原業務推演曾考慮「代理停用不連動下線會員（保留網站收入，避免本末倒置）」。2026-04-22 老闆拍板推翻：
- 停用 = 徹底終結關係（接受下線收入損失）
- 恢復 **凍結** 欄位（freeze=1）作為「保留業務流」的輕度手段
- 使業主有兩種工具可選：重度終結（停用）vs 臨時手段（凍結）

權衡：收入 vs 管理乾淨。老闆選擇讓兩種都具備。

#### 七、不做

- 恢復 UI（所有解除走 DB）
- 整樹自動恢復工具（停用子樹解除要手動逐筆）
- 子樹 cascade 的歷史 config snapshot（重算用當下 config）
- 保留「舊停用不連動會員」選項（老闆已拍板推翻）
