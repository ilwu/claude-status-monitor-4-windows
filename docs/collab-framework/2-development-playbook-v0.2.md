# 2. 指導框架（主場景獨掌）

> **讀者**：**只主場景**。Sub-session 不讀本文件（主場景會在 Phase 交界處送當下 checklist，避 ctx 稀釋）。
>
> **定位**：回答「主場景這步該做什麼？該送給 sub-session 什麼？」的步驟手冊。
>
> **作用域**：**session 內任務推進**（從任務啟動 → 發包 → Phase 執行 → reviewer → commit → summary 固化）。session 間身分交接見 `../session-handoff/`。
>
> **變動性**：高頻更新（新踩坑 / 新 Phase 優化即寫入）。
>
> **版本**：v0.2（2026-04-23 結構重組，詳見 §I）。

---

## TL;DR（60 秒讀懂）

1. **Phase 順序**（§A）— 設計 → 發包前檢核 → 後端/前端 → 整合驗證 → commit → summary
2. **每 Phase checklist**（§B）— 可 checkbox，覆蓋主程序 / reviewer 兩輪 / sys_menu / migration / i18n / 瀏覽器驗 / commit / summary
3. **Phase 交界送 sub-session 什麼**（§C）— 核心設計：分階段遞送當下 checklist 避免一次塞爆（資訊稀釋）
4. **判斷門檻**（§D）— 何時進下一 Phase / 插 reviewer / 派新 sub / 等使用者 / **何時觸發 session 交接**
5. **規範演化 + UI 慣例**（§E）— 規範正文（待累積）vs 候選項目（在 ref/candidate-precedents.md）的分離
6. **任務類型→guide 對照**（§F）— **meta guide 為主**，具體對照表歸各專案 CLAUDE.md
7. **相關文件**（§G）— 本檔和 session-handoff / 1-collab / 3-dispatch 的互補關係
8. **源頭整合**（§H）— 源檔合併聲明

**細節查對應章節**。本 TL;DR 讓主場景快速掃建立地圖。

---

## §A Phase 順序總覽

```
[0 設計]
  └─ DESIGN.md 完成（含沿資料流走一遍驗證）

[發包前 — 主場景動作]
  ├─ 任務類型判斷（Admin / 新模組 / 前端 / 業務修補）
  ├─ 走 §B.0 發包前 checklist（10 段 prompt 含業務描述）
  └─ 寫發包 prompt + call dispatch-reviewer（工具上線後）

[P0.5 ★ 設計驗證 — Sub-session 第一輪思考回饋]
  ├─ 通讀必讀 + 業務描述 + 設計文件
  ├─ 答 4 點：對齊 / 模糊 / 衝突 / 建議
  └─ 主場景收到 → 補資訊 / 上推 / ack 進 P1

[主程序 — sub-session 推進]
  ├─ 後端：
  │    P1 DTO/Schema → P2 Service → P3 Controller+Module → P3.5 ★ reviewer 第一輪
  │    P4-P5 測試（基礎 → 批次）
  └─ 前端（若涉）：
       P6 主 component → P6.5 ★ reviewer 第一輪（可選）

[整合 / 收尾 — sub-session 繼續]
  ├─ P7.1 sys_menu insert（admin 頁面必做）
  ├─ P7.2 DB migration script（若涉新欄位）
  ├─ P7.3 i18n 12 語（核心 3 + 9 語佔位）
  └─ P7.4 測試區同步 TODO 列入

[驗證 — 派新 sub-session]
  ├─ P8.0 API 旁路驗資料層
  └─ P8.1 UI 情境驗證（admin / 廳主 / 代理視角依任務決定）

[最終品質 — sub-session]
  └─ P9 ★ reviewer 第二輪（整合焦點，不帶 CHECKLIST）

[發布 — 協調 commit]
  └─ P10 commit（pathspec / 多 session 序列化 / 略 .md）

[固化 — sub-session 寫 draft → 主場景審]
  └─ P11 任務 Summary（AI-readable / 寫 DESIGN 底部 + topic-set-summary 欄位）
```

**並非每任務跑全 Phase**：

| 任務類型 | Phase 組合 |
|---|---|
| 純後端修補 | P1-P5 + P9 + P10 + P11 |
| 純前端 | P6 + P6.5 + P7.3 + P8 + P9 + P10 + P11 |
| Admin 頁面完整流程 | 全 Phase |
| 純 library 重構 / DevOps | P0 → P1-P3 → P3.5 → P9 → P10 → P11（略前端 / sys_menu / UI 驗） |
| 純文件 / 規範整理 | P0 → P3.5（可選）→ P10 → P11 |

---

## §B 每 Phase Checklist

### B.0 發包前（每新任務必跑）

- [ ] 任務類型判斷（Admin / 新模組 / 前端 / 業務修補）
- [ ] 列任務涉能力（新 table / facade / 交易鎖 / e2e / i18n / migration / sys_menu / 批次 / Excel 匯出 等）
- [ ] 對照 §F 原則 + 專案 CLAUDE.md 對照表，**逐條**加必讀（§B.0.1 ritual 見下）
- [ ] 發包 prompt 10 段齊：
   1. 任務描述（1-2 句 what — 做什麼）
   2. **業務描述**（DDD 業務先行 — **為誰服務 / 解決什麼問題 / 業務流程（現實世界視角）/ 成功指標**）
   3. 必讀（分層、按順序）
   4. 業務理解摘要（5-10 條濃縮 — **規則**層面，和 2 業務描述不同）
   5. 關鍵實作點（3-8 條「用 X 不用 Y」）
   6. 範圍邊界（做 / 不做）
   7. Phase 拆分 + 回報節奏
   8. 執行約束（tsc 0 / 不啟 server / commit 紀律 / 破壞性 git hook）
   9. 測試位置
   10. 回報要求（4 段 + topic id + **含進 P1 前第一輪思考回饋，內容見 §B.0.5 — 主場景要 copy-paste 到發包 prompt**）
- [ ] 若涉前端：i18n 策略段（核心 3 + 9 語佔位）
- [ ] **Admin 頁面必含 P7.1 sys_menu insert 提醒**
- [ ] **Admin 頁面必含 P8.0 API 旁路驗資料層**提醒
- [ ] 跨 session WIP 提醒：「working tree 可能有別 session WIP，pathspec 嚴格限定 X / Y / Z」
- [ ] （dispatch-reviewer agent 定稿後）call agent 驗漏項

#### B.0.1 必讀清單「逐條對照 ritual」（強制）

1. 列本發包涉及的所有**能力 / 技術類型**
2. 對照專案 CLAUDE.md 的 task→guide 表，**逐一**列入必讀
3. 任何一類能力**有對應 guide 但沒列** → 直接踩坑（重建代價）
4. 對照表上**沒有對應 guide** → 發包後主場景考慮補 guide

**特別強調易漏**：e2e 測試場景、交易鎖、i18n、sys_menu、API 旁路 → 涉及時**一定要列**對應 guide

### B.0.5 ★ Sub-session 第一輪思考回饋（設計驗證，進 P1 前必做）

**時機**：sub-session 收到發包、通讀必讀 + 業務描述 + 設計文件後、**進 P1 前**

**目的**：驗證業務描述 ↔ 設計文件對齊、資訊完整性、邏輯一致性（**DDD 業務先行落地**）

> **流程注意**：本節規定 sub-session 的行為，但 sub-session 不讀本文件。主場景必須**將本節 4 點 copy-paste 進發包 prompt 第 10 段**，sub-session 才會執行。

#### Sub-session 必答 4 點

1. **對齊驗證**：業務描述和設計文件對齊嗎？列 3-5 個**具體對齊點**（證明真讀過、真推演過，不是「都對齊」敷衍）
   - 例：「業務要『代理對下代 UP 回收』→ 設計 §四 transfer direction=UP 有對應 / 後端 service 計算代理 += amount / 下代 -= amount」
2. **資訊不足 / 模糊**：列具體**不夠明確**的地方（不是泛稱「細節不足」）
   - 例：「業務描述說『廳主發點給代理』但沒說『可以跨站嗎？』→ 設計文件也沒明示，需釐清」
3. **邏輯衝突**：業務流程 vs 設計實作有**對不上的地方**？
   - 例：「業務說『admin 憑空發點』但設計 transfer service 統一走 wallet 扣減 → 衝突，admin 沒 wallet」
4. **衝突處建議方向**：針對 3 列的衝突，sub-session 的初步判斷

#### 主場景收到後處理

| Sub-session 回饋 | 主場景動作 |
|---|---|
| 對齊點清楚 + 無模糊 / 衝突 | ack 進 P1 |
| 模糊 / 資訊不足 | 補資訊（或補充業務描述段 / 指向 DECISIONS 相關條目）→ sub-session 重回饋 |
| 邏輯衝突 — 技術層 | 主場景拍板（按 §1.2 四原則）→ sub-session 按拍板結果重回饋 |
| 邏輯衝突 — 業務層 | **上推使用者**（§1.2 原則 4）→ 使用者拍板 → 補進業務描述 / 規範 → sub-session 重回饋 |
| 衝突建議方向合理 | 採納、ack 進 P1 |

**不 ack 不動工** — 不回饋或敷衍回饋 = 重做。

#### 和 §C 驗證問題的差異

| 項目 | §B.0.5 第一輪思考 | §C 驗證問題 |
|---|---|---|
| **時機** | 發包後、進 P1 前（**一次性**） | 每 Phase 放行當下（多次） |
| **驗什麼** | 本次任務的**業務 + 設計對齊** | 通用**規範讀懂** |
| **題目** | 4 點（對齊 / 模糊 / 衝突 / 建議）| 3-5 題（核心 / 邊界 / 反例） |
| **失敗後果** | 補資訊 + 上推 → 整份發包有可能改 | 重讀規範 + 補答 |

### B.1 主程序後端 Phases（P1-P3）

#### P1 Entity / DTO 完成

- [ ] Entity `extends BaseEntity`（除不變性記錄外）
- [ ] `OBJECT_ID_FIELDS` 宣告完整
- [ ] 索引設計（unique / 查詢用）
- [ ] DTO 金額欄位 `@CentsField`
- [ ] DTO 驗證裝飾器齊全（`@IsNumber` / `@IsString` / `@Min` / `@MinLength` 等）
- [ ] tsc 0 error

#### P2 Service / Facade

- [ ] Facade 中性（不擋業務 status，檢查上推）
- [ ] 業務規則單一來源在後端（區間上限 / accessScope / 匯出上限）
- [ ] 鎖內查最新資料（避 TOCTOU）
- [ ] lockScope 生命週期正確（acquire / release / executeWithLockScope）
- [ ] tsc 0 error

#### P3 Controller + Module + AdminModule 註冊

- [ ] Controller 路徑對齊既有命名
- [ ] 權限裝飾器（`@Permission` / `@UseInterceptors`）
- [ ] Module imports 完整（table / facade / common）
- [ ] AdminModule（若 admin 頁面）註冊新 module + exports
- [ ] tsc 0 error

### B.2 P3.5 ★ Code Reviewer 第一輪（主程序完成、測試前）

**時機**：P3 tsc 0 後**立即**做，不等測試寫完（若主程序有 bug，測試也白寫）

**帶文件**：
- [ ] `coding-guidelines/README.md`
- [ ] `CHECKLIST.md`
- [ ] 本次涉及的 domain guide（如 agent-commission / wallet / favour）

**Focus**：
- [ ] 命名 / 未用 import / 型別完整（禁 `Promise<any>` 等）
- [ ] error handling（try/catch / async/await）
- [ ] findById 用於編輯（禁用 pageList record）
- [ ] 金額 `@CentsField` 完整
- [ ] Facade 中性（不擋 status）
- [ ] CHECKLIST 逐條對照

**處置分類**：修 / 不修 / 問主場景（不修要附理由 + 引用規範位置；**不可引用「既有 pattern」作拒改依據**，見 §1.3.1）

### B.3 測試 Phases（P4-P5）

#### P4 基礎場景（先寫 3-5 個核心）

- [ ] 測試目錄對齊規範（`test-scenarios-guides`）
- [ ] TestData + Builder 設計
- [ ] Happy path 跑綠
- [ ] assertion 用 errorCode（非 logMessage 文字）
- [ ] `ALLOW_JEST_TEST=true` 本地 .env 已設（§CLAUDE.md 授權自動改）

#### P5 批次場景 + regression

- [ ] 補完設計文件列的所有場景
- [ ] 全場景綠
- [ ] 相關 regression（同 domain 的既有 e2e）也綠
- [ ] 若 regression 紅 → 判斷 pre-existing vs 本包引起

### B.4 前端 Phases（P6-P6.5，若涉）

#### P6 主 component + API 接線

- [ ] API 層新增對應檔（如 `api/v2/XXXX.ts`）
- [ ] index.vue 列表 + 查詢條件
- [ ] Modal 元件（若涉互動）
- [ ] 站點選擇用 `websiteCascade` 共用元件（**不自建 options API**）
- [ ] 金額顯示用 `formatAmount`（後端已 ÷100）
- [ ] 路由 / route 配置
- [ ] pnpm build 0 error

#### P6.5 Reviewer（可選，前端 Vue3 focus）

- [ ] `<script setup>` 慣例 / ref/computed 使用
- [ ] Props/Emits 型別完整
- [ ] async/await + error handling
- [ ] 未用 import / dead code

### B.5 整合項 Phases（P7.x）

#### P7.1 sys_menu insert（admin 頁面**必做**）

- [ ] 寫 `temp/insert-sys-menu-XXXX.js` mongosh script
- [ ] script 含 12 語 i18nName
- [ ] 本地 DB upsert 成功（`upserted: 1` 或 `matched: 1`）
- [ ] 測試區 DB TODO 列入主場景收尾（不當下跑）
- [ ] 重新整理 admin 後台驗側邊欄入口出現

#### P7.2 DB Migration（若涉新欄位 / 表）

- [ ] migration script 寫到 `temp/` 或專案既有 migration 目錄
- [ ] 本地 DB 跑過 + 資料無損
- [ ] 測試區跑時機：主場景收尾或上線前（對齊專案流程）
- [ ] 未上線可直接 drop 舊資料

#### P7.3 i18n 12 語

- [ ] 核心 3 語手做精準翻譯（zh-CN / tw / en）
- [ ] 9 語（id / in / jp / kh / kr / my / ph / th / vn）用 zh-CN 佔位
- [ ] 主場景收尾用 i18n agent 補 9 語（對齊 TODO-10 固化流程）
- [ ] 繁 / 簡差異檢查（不是只 UTF-8 轉換）
- [ ] 語系檔所在目錄對齊專案慣例

#### P7.4 測試區同步項 TODO 列入

- [ ] sys_menu 測試區 upsert（P7.1 的測試區版）
- [ ] migration 測試區執行（P7.2 的測試區版）
- [ ] 部署後測試項（如切區域驗 i18n）

### B.6 瀏覽器驗證 Phase（P8，**派新 sub-session**）

**主場景不自跑**（§1 §6.3 / feedback_chrome_devtools_ui_verify 整合內容）

#### P8.0 API 旁路驗資料層（**先**於 UI 驗）

- [ ] 用 `evaluate_script` 直接 fetch pageList / detail API
- [ ] 判讀 response：total=0 vs total>0
- [ ] total=0 → 資料層空 → 回報主場景決定 seed data / 其他處理
- [ ] total>0 → 進 P8.1 UI 驗

#### P8.1 UI 情境驗證（主場景出清單給 sub-session）

依任務規模選 6-15 情境，常見分類：
- 頁面載入 / 查詢 filter
- 權限範圍（AccessScope）
- 主操作流程（Transfer / Dispatch / Settle 等）
- 前端驗證（金額 / remark / 空輸入）
- 邊界情境（不能對自己 / 餘額不足）
- 跳轉行為（router.push）
- i18n 語系切換

**主場景發包給 browser-test sub-session 時**：
- [ ] 提供完整情境清單（含預期結果）
- [ ] 附登入資訊 / 已登入 tab 指示
- [ ] 限定 `take_snapshot` 只關鍵點用（~15k tokens/次）
- [ ] 優先 `evaluate_script` / `list_console_messages`（精簡）
- [ ] 實際動 DB 的情境用小額 + remark 標記 + 跑完還原

### B.7 P9 ★ Code Reviewer 第二輪（commit 前整合）

**時機**：P8 使用者驗完 OK 後、commit 前

**Focus**（跨模組整合，**不帶 CHECKLIST**）：
- [ ] 跨元件流程（父子 component props/emits 對齊）
- [ ] 前後端對齊（DTO 欄位 / errorCode 對應 i18n / response shape）
- [ ] 邊界情境（race / 狀態機切換 / 並發）
- [ ] 整合 bug（看整體 flow 而非單檔品質）

### B.8 P10 Commit

#### Commit 協調（§1 §6.1）

- [ ] **進 P10 前主場景 4 段回報顯眼標示** 需協調 commit 順序
- [ ] 若同 repo 有其他 session 也在 commit 階段 → 序列化等候
- [ ] 跨 repo 並行 commit 較安全但建議序列化

#### pathspec 嚴格（絕不廣義 add）

- [ ] 列具體改動檔案路徑（不用 `git add .` / `-A` / `-u`）
- [ ] commit 前 `git -C <path> status` 驗 pathspec 對齊
- [ ] 不 add 別 session WIP（如 env/.env.hx / vite.config.ts 類）
- [ ] 不 add .md / docs/** （除非使用者明示）

#### commit message

- [ ] 對齊 repo recent commits 風格（中文 / 英文 / 短 subject）
- [ ] subject < 70 字
- [ ] body 補 what + why（非 how）

#### 若 commit 跨多層（feat + refactor + test）

- [ ] 考慮拆多筆（基礎 + 業務切換 + 測試 三筆）
- [ ] 每筆獨立 tsc 0 可驗
- [ ] 主場景和使用者協調拆法

### B.9 P11 任務 Summary 固化

**對齊 multi-session-dispatch §七之三**（Summary 固化用於 P11 完成時留存技術關鍵給下次接手參考）

#### Sub-session 寫草稿（AI-readable，~1.5k tokens）

- [ ] Phase 線（縮寫連結）
- [ ] 決策 a1-aN（使用者 / 主場景拍板，標 [→候選] 或 [→規範正文 §X]）
- [ ] 偏離拍板 C1-CN（設計文件和實作不符處）
- [ ] 技術關鍵 T1-TN（實作細節，接手要知道但不在 DESIGN）
- [ ] Commits（hash + pathspec）
- [ ] 未完項（→ 後續發包）

#### 主場景審核

- [ ] 換位思考「全新接手 session 看得懂嗎？」
- [ ] 補缺關鍵脈絡
- [ ] 寫入 `docs/audit/<module>/DESIGN.md` 底部 或對應 design 文件
- [ ] 執行 `$MMSG topic-set-summary <topic-id> --author=main-scene` 寫入 currentSummary 欄位
- [ ] [→候選] 決策記入 `ref/candidate-precedents.md`（不是每則都要，只記「未來會再出現」的）

---

## §C Phase 交界送 Sub-session 什麼（避資訊稀釋核心設計）

**核心問題**：發包 prompt 一次塞爆 → sub-session 到 P6 時 P1 細節已稀釋。

**解法**：主場景在 Phase 放行時**只送當下 Phase 的 checklist + 新踩坑提醒**，不重述前面已完 Phase 細節。

### C.1 放行訊息結構模板

```markdown
# [t-xxx] P_{前} 收 + P_{下} 放行

{簡短讚點（具體細節而非敷衍好話）}

## P_{下} 放行內容

### 必帶（sub-session 進 P_{下} 要看的）
- 檔案位置 / 範本
- **必讀規範**（guide 路徑，分層）
- 當下 checklist（§B 該 Phase 的條目）
- 特別提醒（本次任務特殊情境）

### 不必帶
- 已過 Phase 細節（避免稀釋）

## 進 P_{下} 前驗證問題（3-5 題，證明讀懂）

**設計原則見 §C.3（三層：核心概念 / 應用範圍 / 踩坑反例）**

- Q1 核心概念：此規範核心說什麼？（1-2 句濃縮）
- Q2 應用範圍 / 邊界：什麼情境適用？反面？
- Q3 踩坑反例：有什麼反模式？為什麼錯？

**答完主場景 ack 才動工。答錯要求重讀 + 補答，不 ack 不動工**。

## 下一步預告
- 距 commit 還幾步（若 ≤ 2 步提醒協調 commit）
- 任何使用者需先準備的事
```

### C.2 各 Phase 放行訊息該帶的（對應 §B）

**P1 放行**：
- 送：Entity / DTO 位置 + `@CentsField` / `BaseEntity` 原則 + tsc 驗收
- 不送：reviewer 規則、commit pathspec、summary 格式

**P3 放行**（P2 完成後）：
- 送：Controller + Module + AdminModule 註冊要求 + 沿用既有 admin-XXXX pattern 參考
- 不送：測試細節

**P3.5 放行**（P3 完成後，插 reviewer）：
- 送：帶 `coding-guidelines/README.md` + `CHECKLIST.md` + Focus 清單 + 處置分類
- 不送：測試規劃

**P4 放行**（reviewer 修完後）：
- 送：測試目錄規範 + Builder 範本 + 先跑 3-5 個基礎場景
- 不送：commit 細節

**P6 放行**（後端 / 整合 OK 後進前端）：
- 送：前端範本（既有頁面參考）+ websiteCascade 用法 + formatAmount 慣例
- 不送：後端 Service 模式

**P7.1 放行**（sys_menu，admin 頁面必）：
- 送：mongosh script 範本（對齊既有 insert-sys-menu-XXXX.js）+ 本地 + 測試區流程
- 不送：reviewer 細節

**P7.3 放行**（i18n）：
- 送：i18n key 清單 + 翻譯策略（3 + 9）+ 繁簡差異提醒
- 不送：瀏覽器驗情境

**P8 放行**（派新 browser-test sub-session）：
- 送：**情境清單**（~10 個）+ 登入資訊 + chrome tab 指引 + API 旁路 Step 1
- 不送：實作細節（他只驗不動 code）

**P9 放行**（reviewer 第二輪）：
- 送：Focus 清單（跨元件 / 前後端對齊 / 邊界）+ 不帶 CHECKLIST
- 不送：第一輪 reviewer 結果（已過）

**P10 放行**（commit）：
- 送：**commit 順序協調指示**（已和使用者確認） + pathspec 清單 + commit message 建議
- 不送：其他

**P11 放行**（Summary）：
- 送：Summary 格式範本（Phase 線 / 決策 / 偏離 / 技術關鍵 / commits / 未完）
- 不送：未來任務規劃

### C.2.1 驗證問題範例集（關鍵 Phase）

**P3.5 放行時**（進 reviewer 第一輪前驗證）：
1. CHECKLIST 核心檢核項 5-7 條？（命名 / 型別 / try-catch 慣例 / findById / @CentsField...）
2. `既有 pattern` 何時可引用、何時不可？（§1.3.1 — 已入規範 OK / 沒有規範 NO）
3. reviewer 發現項分類 3 類分別怎麼處理？（修 / 不修 / 問主場景 + 各需什麼佐證）

**P6 前端放行**（進前端開發前驗證）：
1. 分元轉換怎麼做？後端 `@CentsField` + 前端 `formatAmount` 各自職責？
2. 金額顯示：整數（信用點 `formatAmount(v, 0)`）vs 有小數（一般金額 `formatAmount(v)`）的邊界？
3. 前端自己 `×100` / `÷100` 會出什麼問題？

**P7.1 sys_menu 放行**（進整合項前驗證）：
1. sys_menu 本地 vs 測試區同步流程差在哪？
2. 為什麼不能只改 `init_sys_menu.ts` 就算完？（需重啟 server 才寫 DB → 實務用 mongosh upsert script）
3. i18nName 12 語該怎麼填？（核心 3 手做 + 9 佔位）

**P8 瀏覽器驗放行**（派 browser-test sub-session 前驗證）：
1. `take_snapshot` 和 `evaluate_script` 各自何時用？ctx 成本差？
2. API 旁路為什麼先於 UI 驗？判資料層 vs UI 層怎麼判？
3. 實測有副作用情境（如 Transfer）怎麼處理？（小額 + remark 標記 + 跑完反向）

**其他 Phase 放行**：主場景當場依 §C.3 原則設計 3-5 題

### C.3 驗證問題設計原則

**每次放行 3-5 題，覆蓋三層**：

| 層 | 問什麼 | 目的 |
|---|---|---|
| **核心概念** | 這規範核心說什麼？（1-2 句濃縮）| 確認有讀到要點 |
| **應用範圍 / 邊界** | 什麼情境適用？反面？邊界值？ | 確認知道「什麼時候不用」|
| **踩坑反例** | 反模式 / 具體錯法 / 為什麼錯 | 確認理解到 deep enough |

**目的：驗證讀懂，不是背書**

答題用自己話說 = OK；抄原文 = 沒讀懂 → 重讀。

**和 knowledge-validation-sop 的差異**：

| 項目 | 本 §C 日常驗證 | knowledge-validation-sop |
|---|---|---|
| 規模 | 3-5 題 | 10-15 題 |
| 時機 | 每 Phase 放行當下 | 模組知識固化後 |
| 目的 | 確認當下 Phase 讀懂 | 驗證文件自給自足 |
| 及格 | 答對即 ack | ≥ 80% 及格 / 補救至 100% |
| 深度 | 當下規範 | 跨文件整合 |

需要深度抽測（例主線交接、模組完成後驗文件品質）→ 走 `knowledge-validation-sop` 完整 Round 1/2 流程。

**Sub-session 答題的拒收格式**：
- 答得含糊 → 主場景追問具體（指明該問題的哪層）
- 抄原文 → 要求「用自己話說」
- 不會 → 指向規範具體節，要求重讀後補答

---

## §D 判斷門檻（主場景決策節點）

| 情境 | 動作 |
|---|---|
| Sub-session 回報 tsc 0 | 放行下一 Phase |
| **Sub-session 第一輪思考回饋**（進 P1 前）| 對齊+無模糊衝突 → ack 進 P1；模糊 → 補資訊；技術衝突 → §1.2 拍板；**業務 / UI 衝突 → 上推使用者**。不 ack 不動 P1（§B.0.5）|
| **Sub-session 答完放行前驗證問題** | 答對 → ack 動工；答錯 / 含糊 / 抄原文 → 要求重讀 + 補答，**不 ack 不動工**（§C.1）|
| P3 完成（Controller + Module）| **必**插 P3.5 reviewer 第一輪 |
| P5 批次測試綠 | 確認 regression 也綠 → 進 P6 前端 |
| Regression 紅 | 判斷 pre-existing vs 本包引起；pre-existing 標 TODO 不阻塞；本包引起修完再進 |
| Admin 頁面 P6 完成 | **必**提醒 P7.1 sys_menu + P8.0 API 旁路（避重蹈 2026-04-21 覆轍） |
| reviewer 發現 🔴 Critical | 停進下一 Phase → 修完再進 |
| Sub-session 請示技術問題 | 查 §1.2 四原則（規範 / 實作 / 前提）→ 拍板 |
| Sub-session 請示業務決策 | 上推使用者（§1.2 原則 4）|
| Sub-session 請示 UI 決策 | 上推使用者（§1.2 原則 4）|
| Sub-session 用「對齊既有 pattern」不修 reviewer | 查該 pattern 是否已入規範正文；沒 → 按 reviewer 改（§1.3.1）|
| Sub-session 距 commit ≤ 2 Phase | 4 段回報顯眼標「需協調 commit 順序」|
| 同 repo 有其他 session 在 commit | 序列化等候 |
| **ctx ≥ 70%** | 預警、整理未完事項（work state 盤點）|
| **ctx ≥ 85%** | 準備交接（列 inbox / 識別未完 topic / 想脫手順序） |
| **ctx ≥ 90%** | **按 `../session-handoff/main-scene-playbook.md` 階段 0 啟動交接流程**（不拖延，再拖寫不動） |
| P10 commit 完成 | **立即**進 P11 summary（不拖延，ctx 還新鮮）|
| 使用者拍板新規則 / 場景 | 記入 `ref/candidate-precedents.md`（不立即升規範）|
| 使用者說「整理候選」 | 讀 ref/candidate-precedents.md → 統整 → 升級或廢止 |

---

## §E 規範演化 + UI 慣例

**規範演化流程**：見 `1-collaboration-protocol.md §1.3.1 / §1.4`（既有 pattern ≠ 權威 + 候選 → 規範 升級路徑）。本節不重述。

### §E.1 已升級進規範正文的 UI 慣例

（當前空，待累積）

*說明*：當某條 UI 慣例從候選升級（由使用者觸發整理流程確認）後，將條目遷入此節。在此之前，**所有 UI 慣例視為候選、非權威**。

### §E.2 候選 UI 慣例

**位置**：`ref/candidate-precedents.md`

**主場景平常不讀**（避免讀候選當規範）。僅使用者明示「整理候選」時讀取、統整、依升級條件 promote 到 §E.1 或廢止。

---

## §F 任務類型 → Guide 對照（Meta Guide）

**原則**：有 guide 的就放必讀；沒 guide 的才讓 sub-session 從既有 code 摸。

### §F.1 對照表結構建議

各專案在自己的 CLAUDE.md（或 docs 對應位置）維護具體對照表，通常兩層：

| 層 | 範例項目 | 特徵 |
|---|---|---|
| **框架 / 技術能力** | 新 table / facade / 交易鎖 / DbOperation / ledger / 排程 / cache / interceptor / decorator / i18n / Dynamic Fields / batch transaction / ... | 跨業務通用 |
| **業務領域** | 錢包 / 優惠 / 統計 / 代理佣金 / 遊戲商介接 / 支付 / 風控 / 站點 / ... | 業務 specific |
| **整合能力**（交叉） | Admin 後台頁面（框架 + domain + i18n）/ 測試場景（domain + test pattern）| 多類混合 |

### §F.2 組合判定

看任務涉及哪些「能力」。例：**Admin 頁面 + 新 table + 交易鎖 + ledger** → 四項 guide 都放。

### §F.3 專案範例

- **Platform-BackendServer**：`CLAUDE.md §工作觸發條件` 已有完整對照表（錢包 / 優惠 / 統計 / admin / ...）
- **Platform-NewBackendSystem**：（TODO 待補 CLAUDE.md 對照表）
- **platform-website**：（TODO 待補）

### §F.4 跨專案共用 pattern

若某能力跨多專案重複出現（如 i18n / sys_menu / commit 紀律），主場景判斷值得抽取成跨專案指引時：

1. 先記入 `ref/candidate-precedents.md`（候選）
2. 使用者觸發整理 → 升級至 `collab-framework/` 的獨立檔或進本檔 §E.1

**原則**：**通用文件不寫專案特定對照**；專案對照寫專案 CLAUDE.md。

---

## §G 相關文件（本檔職責分工）

**本檔作用域**：**session 內任務推進**（任務啟動 → 發包 → Phase 執行 → reviewer → commit → summary 固化）

### §G.1 collab-framework 內的互補文件

| 文件 | 作用域 | 何時讀 |
|---|---|---|
| `README.md` | collab-framework 入口 + 7 個設計決策 | 第一次接觸協作框架時 |
| `1-collaboration-protocol.md` | 三角色邊界 / 拍板四原則 / topic 機制 / commit 紀律 / 接手方法論 | 每主場景必讀（共用基礎） |
| **本檔 `2-development-playbook.md`** | **session 內任務推進 SOP** | 發包 / Phase 放行 / 判斷門檻時 |
| `3-dispatch-reviewer-spec.md` | dispatch-reviewer agent 規格 + PreToolUse hook | 發包前擋漏項（agent 上線後） |
| `ref/candidate-precedents.md` | 候選判例庫（未升級規則） | 使用者觸發整理時才讀 |

### §G.2 session-handoff 銜接

| 文件 | 作用 |
|---|---|
| `../session-handoff/README.md` | handoff 方法論 why（LLM 交接當工程可靠性問題） |
| `../session-handoff/main-scene-playbook.md` | **session 間身分交接** 7 階段 SOP（原主場景 ctx ≥ 90% 或使用者脫手時讀） |
| `../session-handoff/examples/business-derivation.md` | 業務骨架範例 |
| `../session-handoff/examples/DECISIONS.md` | 關鍵決策歸檔範例 |

### §G.3 本檔 ↔ session-handoff 銜接點

**本檔管「task in progress 怎麼推」，session-handoff 管「session 人不在了怎麼交棒」**。兩者在 §D ctx 80-90% 區段銜接：

```
ctx < 70%   — 正常推進（本檔 Phase 流程）
ctx ≥ 70%   — 預警（本檔 §D）
ctx ≥ 85%   — 準備交接（本檔 §D / 列清單）
ctx ≥ 90%   — 啟動交接（交棒給 session-handoff playbook）
```

**觸發 session-handoff 後**：
- 本檔當次任務如有未完 Phase → 寫入交接 topic 的首訊息（由新主場景接續）
- 本檔 §B 各 Phase checklist → 新主場景接手後若繼續該任務，引本檔對應章節

---

## §H 源頭整合聲明

本文件整合自以下源檔（源檔於本目錄的副本 + 源頭散落位置在 collab-framework 定稿後全數拔除）：

| 整合來源 | 對應本文件節 |
|---|---|
| `multi-session-dispatch §七之二` 品質檢查兩輪 | §B.2 P3.5 + §B.7 P9 + §D 判斷門檻 |
| `multi-session-dispatch §七之三` Summary 固化 | §B.9 P11 |
| `multi-session-dispatch §8.11` Commit 序列化 | §B.8 P10 + §D 判斷門檻 |
| `dispatch-prompt-handbook` 全 | §B.0 發包前 + §F 對照表（v0.2 改為 meta） |
| `dispatch-prompt-handbook §附錄 A` sys_menu | §B.5 P7.1 |
| `dispatch-prompt-handbook §附錄 B` Excel 匯出 | §E.2 候選（待整合）|
| `dispatch-prompt-handbook §附錄 C` 邊角檢核 | §B.0 發包前 |
| 新設計 | §C Phase 交界送 sub（避稀釋核心） |
| v0.2 新增 | §G 相關文件（和 session-handoff 銜接）|

---

## §I 版本 / Changelog

### v0.2 — 2026-04-23 結構重組

**動機**：v0.1 實戰中暴露結構性矛盾（§F 專案特定內容塞通用文件 / §E 空 vs 候選不清 / 和 session-handoff 沒 cross-reference / §B.0 自身是 ctx 巨獸）。

**改動**：

- **§F** 從「Platform-BackendServer 特定對照表」→ 改為 **meta guide**（原則 + 結構建議 + 各專案範例）。具體對照表歸各專案 CLAUDE.md
- **§E** 結構清理：明確分離 §E.1「已升級規範正文」（當前空）vs §E.2「候選位置」（指向 `ref/candidate-precedents.md`）。原有候選項例全部移除（改由使用者觸發整理時從 candidate-precedents 升級）
- **§D** ctx threshold 明確化：70% 預警 / 85% 準備交接（整理清單）/ 90% 啟動 session-handoff playbook
- **§G** 新增「相關文件 + 本檔職責分工」— 列 collab-framework 內互補關係 + session-handoff 銜接點（80-90% ctx 區段）
- **TL;DR** 加第 7 條指向 §G 相關文件
- **§B.0.5** 新增流程注意：主場景必須 copy-paste 本節 4 點進發包 prompt（sub-session 不讀本檔）
- **§A** 加「純 library 重構 / DevOps」「純文件整理」Phase 組合（原僅列 Admin / 純後端 / 純前端）
- **作用域聲明** 放到文件頂部（session 內任務推進 vs session 間身分交接）
- **文件檔名**：新版 `2-development-playbook-v0.2.md`，舊版 `2-development-playbook.md` 保留供對比參考（待 promote 決策後 rename）

**不動**：§A / §B / §C / §H 內容（只調編排）

### v0.1 — 2026-04-21 建立初版

B.0-B.9 全 Phase / §C 交界送 sub / §D 門檻 / §F 對照表（v0.1 版 — 含 Platform-BackendServer 特定路徑）
