# 1. 協作流程（主 + 子 session 共通規範）

> **讀者**：使用者、主場景、Sub-session（所有參與 Claude Code 多 session 協作的角色）
>
> **定位**：回答「多個 session 怎麼互動」。規範性文件，穩定後少變動。
>
> **讀完能答**：我是誰 / 我能做什麼 / 不能做什麼 / 怎麼回報 / 什麼時候等待。

---

## TL;DR（60 秒讀懂）

1. **三角色**（§1.1）— 使用者決策 / 主場景統籌技術 / Sub-session 執行
2. **拍板原則**（§1.2 + §1.3）— 主場景四原則（查規範 / 對實作 / 對前提 / 業務+UI 上推）；Sub-session 純實作自拍 / 跨層回報 / 業務+UI 必停；**既有 pattern ≠ 權威**（§1.3.1）
3. **規範演化**（§1.4）— 缺口 → 上推使用者拍板 → 先丟候選判例庫（ref/ 平常不讀）→ 使用者觸發整理 → 升級規範或廢止；**不建常駐判例庫**
4. **回報格式**（§4）— 主場景 4 段（標 topic-id + Q 複雜全列/簡短）；Sub-session mmsg + 介面兩輸出都標 topic-id
5. **Topic / Race**（§2 + §5）— MMSG = `C:/workspace/tools/mmsg.cmd`，每 session 第一指令設 `$MMSG`；回報 = 等放行不自推進
6. **紀律**（§6）— commit 略 .md / pathspec 嚴格 / 多 session 同 repo 序列化 / 破壞性 git hook 擋 / **瀏覽器派 sub-session**

**細節查對應章節**。本 TL;DR 給 AI 快速掃建立全局地圖。

---

## §1 三角色職責邊界

```
使用者（業主 / 決策者）
  ↓ 業務方向 / 最終拍板 / 驗收
主場景（Main Scene — 統籌 session）
  ↓ 技術拍板 / 發包 / Phase 放行 / ctx 管理
Sub-session（子場景 — 執行 session）
  ↓ 實作 / 回報 / 遇業務決策停
```

### 1.1 角色表

| 角色 | 做 | 不做 |
|------|----|------|
| **使用者** | 業務決策、方向指引、commit 協調、最終驗收 | 技術細節微調、tsc 錯誤排查、代跑瀏覽器測試（派 sub-session 做） |
| **主場景** | 統籌、發包 prompt、review 回報、**拍板技術決策**、整合報告、ctx 管理、Phase 間送指引避 sub ctx 稀釋 | 最終業務拍板（上推使用者）、大規模重構、代跑 sub-session 的活 |
| **Sub-session** | 執行 Phase、測試、回報、遇阻請示、**自主純實作層決策** | **業務決策**（必停）、**擴大範圍**、破壞性 git、commit 不等放行 |

### 1.2 主場景拍板四原則

**技術決策的自信來源是「對齊既有規範」**。沒掌握規範 → 「自己拍」會變「自己想」→ 設計偏離系統認知。

**原則 1：拍前先掌握系統設計規範**

拍板前要知道規範在哪、內容是什麼。查詢路徑：
- 架構原則（`architecture-guides`）
- 編碼規範（`coding-guidelines` + `CHECKLIST.md`）
- Domain 規則（`domain-guides` 下各模組）
- 既有案例（近期完成的同類任務實作碼）
- DECISIONS.md 主題索引

**處理規則缺口**：若查遍規範**沒有涵蓋** → **不要自己設計**，走 §1.4 規範缺口處理流程（上推使用者形成新規範 → 加入文件）。

**反例**：sub-session 問「這個 DTO 欄位用 `@CentsField` 還是手動 ×100？」主場景沒查 domain-guides，憑感覺答「手動 ×100」→ 後發現其他模組全用 `@CentsField`，拍錯方向。

**原則 2：拍前先對照實作**

設計文件可能滯後，**實作才是真相**。遇 sub-session 請示 → `grep` 實作 / 讀對應 facade / service → 對照設計文件差異 → 拍板。

**反例**：設計寫「X > 1」以為是筆誤改「X >= 1」，但沒查 facade 內部有 `X <= 1 throw` → 拍板後 sub-session 跑測試才發現邊界不符。

**原則 3：拍前對照當前專案前提**

業務決策前記清當前約束：
- 時程壓力（幾週內上線？）
- 系統現況（未上線 / 正式運行 / 過渡期）
- 使用者明示邊界（「舊系統不用」/「不考慮相容」）
- 已決的大方向（不走回頭路）

**反例**：主場景拍「中期 1-2 月做某整合」但忘了使用者明說「兩週內上線」→ 方向錯需撤回。

**原則 4：業務決策 + UI 必上推**

技術決策自己拍 + Q&A 給使用者看（讓他有機會 override）。以下**必停上推**使用者：

| 類別 | 例 |
|------|----|
| 新功能範圍 / 業務規則語意 | 「(c) 方案 pending 時不動信用點」 |
| 向後相容 vs 激進切換 | 「A1''  一次切 5 service」 |
| 優先級 / 時程調整 | 「credit-point 獨立包 vs 本包做完」|
| 多個可行選項且業務意義不同 | 「commit 拆 3 筆 vs 合 1 筆」|
| **UI 決策**（佈局 / 樣式 / 互動 pattern / 文案選擇）| 「Modal 二次確認要 checkbox 還是 popconfirm」 |

**UI 上推理由**：UI 不是純技術 — 屬使用者品味 / 營運觸達 / 業務判斷。即使 UI 是 sub-session 在實作，其**行為模式選擇**仍要上推（除非發包 prompt 已明確寫）。

### 1.3 Sub-session 自主判斷 3 類

| 類別 | 描述 | 行動 |
|------|------|------|
| ✅ **純實作** | tsc 錯、路徑錯、命名對齊、未用 import、1-2 行 typo、小重構（如注入簡化）、本地技術判斷（查 table vs 走 facade 等效） | **自己拍**，回報時提一行「順手修 X」 |
| 🟡 **跨層 / 跨模組** | 改 facade DTO 簽名、新加 enum 值、跨模組 import 關係變化、影響測試 fixture | **回報主場景確認**，不自動推進 |
| 🔴 **業務決策** | 流程異動、欄位語意、範圍擴大、和設計規範衝突、實作發現設計矛盾 | **必停** + `mmsg topic-add` 請示 + 等放行 |

**判斷依據**：改動若只影響「本模組本次任務」→ ✅；若影響其他模組 / 未來維護 → 🟡；若涉及業務行為 / **UI 行為模式** → 🔴。

**最重要的邊界**：sub-session 遇**業務決策 / UI 決策**必停，不自推進。

### 1.3.1 既有 Pattern 不作為權威

Sub-session **不可**用「對齊 X 既有 pattern」作為**不修 reviewer 建議 / 抗拒 checklist** 的理由。

**理由**：
- 既有 pattern 可能是**歷史遺留 / 舊 code / 尚未更新的舊規範**
- 機械模仿 → 錯誤延續(bad code 被複製到新模組)
- **Checklist 才是當前標準**

**正確處理流程**：
1. Reviewer 提出建議（按 checklist）
2. Sub-session **查**：該建議和既有 pattern 衝突嗎？
3. 若**既有 pattern 已寫入規範正文**（checklist / 編碼 guide / coding-guidelines）→ 可依**規範條目**拒絕修改 + 回報引用規範位置
4. 若**既有 pattern 只是「代碼就這樣寫」沒有規範背書** → **按 reviewer 建議修**，不得以「對齊既有」為由推遲
5. 若想修 pattern 全庫（既有 + 新增統一）→ 回報主場景評估範圍

**反例**（實證）：sub-session reviewer 結果 `IMP-4 不修：Promise<any> 對齊 2613 pattern` — 2613 的 Promise<any> 本身就違反 checklist（型別不完整），用它作為不修理由是錯誤延續。正確應按 checklist 修為具體型別，並標記 2613 為待改 TODO。

---

### 1.4 規範演化機制（單一權威 + 候選暫存，不建常駐判例庫）

**核心原則**：
- 規則**只在規範正文**（collab-framework 1/2/3 + checklist / coding-guidelines / DECISIONS）
- 不建常駐判例庫（避免資訊爆炸 / AI 自動 pass）
- 使用者拍板結果先丟**候選判例庫**（ref 文件，平常不讀）
- 使用者觸發「整理候選」時才統整 → 部分升級規範正文、部分廢止

### 1.4.1 兩種觸發場景

**場景 A — 規範真空（缺口）**：主場景遇請示、查遍規範仍沒找到適用規則
**場景 B — 規範不完整（重複出現）**：同一選擇題**實測重複 ≥ 2 次** → 涵蓋不夠應升級

### 1.4.2 處理流程（兩場景統一）

```
Sub-session 請示 / 觀察重複出現
     ↓
主場景查規範（§1.2 原則 1）
     ↓
   有規範 → 按規範拍 → 完
   沒規範 / 不完整 ↓
主場景上推使用者
  - 問題情境
  - 2-3 選項 + 後果
  - 標「規範缺口 / 不完整，需拍板」
     ↓
使用者拍板
     ↓
主場景記入候選判例庫
  （candidate-precedents.md，ref 文件，平常不讀）
     ↓
放行 sub-session 按拍板結果實作
     ↓
[未來某時點] 使用者觸發「整理候選」
     ↓
主場景統整：
  - 重複出現 / 適用廣 → 升級規範正文
  - 一次性 / 範圍窄 / 過時 → 廢止
```

### 1.4.3 候選判例庫的定位（防資訊爆炸）

| 屬性 | 候選判例庫 | 規範正文 |
|---|---|---|
| 讀取時機 | **平常不讀**（ref 文件，只在整理時）| 日常查詢 |
| 記錄門檻 | 使用者拍板即記 | 整理後的升級項 |
| 規模 | 可累積但不 load 不影響 ctx | 只含當前有效規則 |
| 引用權威 | ❌ **不可作 sub-session 拒改依據** | ✅ 可引用 |
| 對 sub-session | **透明**（不讀不引用）| 日常查詢對象 |

### 1.4.4 候選判例庫位置與格式

位置：`collab-framework/ref/candidate-precedents.md`（**ref/ 子目錄 = 平常不讀的參考資料**）

格式（每行 1 候選，精簡表格）：

```markdown
# 候選判例庫（ref 文件，平常不讀）

| ID | 日期 | 情境 | 決策 | 來源 | 備註 |
|---|---|---|---|---|---|
| CA-001 | 2026-04-21 | Promise<any> 對齊既有 pattern 不修 | 按 checklist 改具體型別 | t-98645f16 seq=13 | reviewer IMP-4 |
...
```

### 1.4.5 整理流程（使用者觸發）

使用者說「整理候選」→ 主場景：
1. 讀 `candidate-precedents.md`
2. 每則評估：
   - ✅ **升級**：重複出現 / 適用廣 → 寫入規範正文 + 候選標「已升級 → 見 §X.Y」
   - ❌ **廢止**：一次性 / 範圍窄 / 過時 → 候選標「廢止，理由」
3. 回報使用者統整結果
4. 使用者確認後，清理候選表

### 1.4.6 核心精神

- 規則 = **使用者的決策空間**（主場景識別缺口 / 提供選項 / 記錄決策）
- 規範 = **單一權威版本**（只長正文）
- 候選 = **過渡暫存**（不稀釋 ctx、使用者控制升級節奏）
- 拍板不遺忘 + 規範不爆炸 = 兼得

**反例**：sub-session 問「bindBank 排序」→ 查沒找到 → 上推 → 使用者拍「舊到新」→ 主場景記入 `candidate-precedents.md` 為 CA-00X → 放行 sub-session。未來使用者觸發整理，若此條適用廣（多頁面都用到）→ 升級進 `2-development-playbook.md` UI 慣例節 + 候選標「已升級」。

---

## §2 Topic 與 mmsg 機制

### 2.1 實際 CLI 路徑

**MMSG CLI 位置**：`C:/workspace/tools/mmsg.cmd`（git-bash 預設 PATH 不含此路徑）

**每個 session 第一個指令先設變數**：
```bash
MMSG=C:/workspace/tools/mmsg.cmd
$MMSG topic-show t-xxx        # 之後用 $MMSG 即可
```

或完整路徑：`C:/workspace/tools/mmsg.cmd topic-show t-xxx`

### 2.2 Topic 兩類型

**Type 1 — Session 記憶型**
- 一 session 一 topic（獨占）
- 自動記錄 UserPromptSubmit / Stop / PostToolUse（走 hook）
- 每 10 輪觸發 LLM summary + 更新交接 prompt
- 生命週期：session 結束即停更，保留供接力

**Type 2 — 派工型**
- 任務名稱（`credit-point 信用點模組發包`）
- 多 author 協作（`main` / `credit-point-session`）
- metadata 可含 `derived_from`（源自哪個 Type 1 討論）
- 生命週期：任務完成 → 封存

**跨 Type 關聯**：Type 1 討論 → 結論發包為 Type 2；Type 2 metadata `derived_from` 指回 Type 1，追溯設計理由。

### 2.3 常用指令

```bash
# session 啟動設 MMSG 變數（強制，每新 session 第一個指令）
MMSG=C:/workspace/tools/mmsg.cmd

# 跨 session 主題對話
TOPIC=$(echo "起頭訊息" | $MMSG topic-new --title="xxx" --author=main)
echo "後續回覆" | $MMSG topic-add $TOPIC --author=sub
$MMSG topic-show $TOPIC                   # 看完整 thread
$MMSG topic-show $TOPIC --latest=5        # 只看最近 5 條
$MMSG topic-list --recent=24h             # 近 24h 主題

# Session 救援
echo '{"current_task":"...","next_steps":[...]}' | $MMSG snapshot
$MMSG recovery --session=<session-id>     # 接手用，輸出 Markdown

# 當前狀況總結（topic-set-summary API，2026-04-21 新增）
cat summary.txt | $MMSG topic-set-summary <topic-id> --author=main-scene
# topic-show 會在 title 之後、seq=1 之前顯示 📌 Summary block
```

### 2.4 執行前提

- Minitor tray app 要在跑（右下角橘色圖示）；沒跑時 `mmsg` 回 exit 3
- `mmsg` 預設用 `MINITOR_PORT=19823`

### 2.5 命名由來

原本叫 `msg` 但 Windows 內建 `msg.exe`（server 廣播）搶 PATH，所以改叫 `mmsg`（minitor message）。

---

## §3 發包格式（sub-session 收到什麼）

### 3.1 發包 prompt 必含段落

每份發包 prompt **強制**包含：

1. **任務描述**（1-2 句 what）
2. **必讀文件**（按順序，分層）
3. **業務理解摘要**（5-10 行濃縮）
4. **關鍵實作點**（3-8 條「用 X 不用 Y」）
5. **範圍邊界**（做 / 不做）
6. **Phase 拆分 + 回報節奏**
7. **執行約束**（tsc 0 / 不啟 server / commit 紀律 / 破壞性 git hook）
8. **測試位置**
9. **i18n 策略**（若涉前端）
10. **回報要求**（強制標 topic id 格式）

### 3.2 Sub-session 接手動作（收到發包後）

1. **設 MMSG 變數**：`MMSG=C:/workspace/tools/mmsg.cmd`
2. **跑 `$MMSG topic-show <本 topic-id>`** 讀完整發包
3. **跑 `git -C <repo> status`** 確認 working tree 狀態（可能有別 session WIP，不要動）
4. **通讀必讀文件**
5. **重述理解 5-8 句 + 列第一步**，`mmsg topic-add` 回報等主場景放行
6. **不自動動碼** — 等明確放行才進 P1

### 3.3 Sub-session 主動權（授權清單）

session **可主動**：
- 指出 prompt 沒涵蓋的邊角
- 質疑必讀文件和實作不符
- 調整 Phase 拆分（實作發現某 Phase 太大可拆，回報對齊）
- 動工前跑 git status 兩邊 repo 確認
- 發現既有架構 bug 先停下（不自行擴大範圍修，列為 TODO 回報）

---

## §4 回報格式

### 4.1 主場景對使用者回報（強制 4 段）

```markdown
## [t-xxxxxxxx | session 名] Phase X

**執行**：✅ / 🟡 部分 / ❌ 阻塞（一句話）

**摘要**：session 做了什麼、驗收數字（tsc / 測試 / build）、關鍵判斷

**Q&A**（session 請示 / 主場景拍板）：
- Q: ...
- A: ...

**⚠ 需你決策**：
- [ ] 項目 1（附選項 + 我的建議）
- 或 「無，繼續推」
```

**原則**：
- **永遠標 topic id**（使用者不翻找）
- **永遠寫「需你決策」段**（即使沒也寫「無」）
- **不跳過 Q&A**（使用者看得到脈絡）
- **摘要含驗收數字**（tsc 0 / X 測試綠，不用「全過」帶過）

### 4.2 Q 段分級（2026-04-21 使用者明示）

**複雜決策 → Q 全列**（花 ctx 值得）：
- 跨 session 決策、業務語意拍板、多選項權衡、sub-session 主動揭露偏離

格式：
```
Q: [sub-session 問什麼 + 為什麼 — 3-5 句情境]
選項：
 - A: ...（優缺點）
 - B: ...（優缺點）
我的分析：[為什麼選 X]
A: [最終答案]
```

**純技術放行 → Q 簡短**：
- 小 patch、已拍板過的延續、對齊既有規範

格式：`Q: xxx？A: 是`

**判準**：「省略 Q 情境/選項/分析，使用者能否正確拍板？」能 → 簡短；不能 → 全列。

### 4.3 Sub-session 的兩種輸出（都要標 topic id）

**輸出 A — `mmsg topic-add` 訊息**：
```markdown
# [t-xxxxxxxx] P? 完成 — 1 句摘要

（改動檔案清單、驗收數字、偏離設計說明、下一步預告）
```

必要元素：
- 標題第一行 `# [topic-id] P? 完成/中途請示 — 摘要`
- 改動檔案清單（後端 / 前端分列）
- 驗收數字（tsc / 測試 / build）
- 偏離設計文件（有則說明，沒有寫「無」）
- 下一步預告

**輸出 B — Sub-session 對「自己 Claude 介面」的階段回報**：

使用者看 sub-session 自己介面的 `●` 符號訊息時，要能快速定位 topic：
```
● [t-xxxxxxxx] P? 完成：摘要
```

觸發時機：
- Phase 完成宣告
- 中途請示
- 錯誤 / 警告回報
- 發送 mmsg topic-add 前後的「我做了什麼」總結

**不需要標的**：Read / Grep 的中間輸出、思考過程、不涉及使用者轉貼的細節。

---

## §5 Race 規則（Sub-session 不可自推進）

Sub-session **不可**「回報 A 階段 + 立刻推進 B 階段」。

**規則**：
1. 回報 = 等放行（等主場景 author 的 ack）
2. 等放行期間可做**不產生決策分歧的準備動作**（讀文件、規劃下一步）
3. **不可**動程式碼 / 動檔案 / 動測試（避免放行者糾正時要回退）

**例外**：發包 prompt 明確授權「無阻塞直接推進」（如 Phase 1-3 全部自動 ack）。

**反例**：sub-session 看 reviewer 結果後「請示」但同時已開始改 code → 主場景決定反駁誤報時要回滾。

---

## §6 協作紀律

### 6.1 Commit 紀律

**略過文件**：commit 預設略過 `.md` / `docs/**`；使用者明說才提交。

**Pathspec 嚴格**：
- **絕不** `git add .` / `-A` / `-u` 類廣義 add（多 session 並行會誤帶別 session WIP）
- 每筆 commit 明確列 pathspec
- commit 前 `git status` 確認

**多 session Commit 序列化**：
- **同 repo 一次只有一個 session 在 commit**
- Sub-session 進 commit Phase 前，主場景**對使用者 4 段回報顯眼標示「下一 Phase=commit，需協調順序」**
- Sub-session 收到 commit Phase 放行前**等主場景明確指示**，不自推進

**2026-04-20 實證**：admin-2614 session 和 credit-point session 同日交錯 commit（`29b81caa` / `27b99410` / `2f41d43f` / `b43da739`），造成 HEAD 異常，credit-point 模組檔案在中間 commit 被 shadowed，使用者親自介入協調才解困。

**根本問題 — Session 時間感知滯後（2026-04-22 補）**：

每個 session（含主場景）**對「現在」的認知永遠停留在**自己上一次對話結束那一刻，其他並行場景仍在推進。這是 AI session 的系統性 race，**不能靠 session 自己判斷「現在安不安全」解決**。

| 情境 | 問題 |
|------|------|
| **同 repo 多 session commit** | 各 session 不知別人剛剛是否 commit；交錯推送造成 HEAD 混亂 |
| **跨 repo 多 session 改耦合 DTO** | 後端 session commit 改 DTO shape 後，前端 session 的「現在」還停在舊 DTO；tsc 不跨 repo 檢查，踩坑到 P8 瀏覽器驗才炸 |

**現行最便宜解 — 使用者 gate-keep**：
- 主場景發 commit 拍板前 → **提醒使用者「下一步要 commit，請確認無其他 session 正在 commit」**
- 使用者**手動確認其他場景狀態**（用自己對「真實現在」的視角）→ 確認無 race 才轉達拍板
- 跨 repo 場景同理：使用者檢查前後端兩邊 session 狀態
- **為什麼 gate-keep 是使用者** — 只有使用者能同時看到所有並行場景的真實狀態；AI session 自己判斷必踩滯後問題

**規則**：主場景進 commit 放行訊息**必含**以下句：
```
⚠ 進 commit 前請使用者確認：當前無其他 session 在 [同 repo / 關聯 repo] commit 階段
```

**未來 TODO（不急）— mmsg 加鎖訊號**：
- mmsg 加「commit lock」API：session commit 前 `mmsg lock-acquire <repo>`，commit 後 `lock-release`
- session 拿不到鎖 → 等 / 警告
- 目的：把 gate-keep 從使用者自動化到 mmsg 工具層
- 不急：現階段使用者 gate-keep 已可用，自動化是優化非必要

### 6.2 破壞性 Git 操作禁忌

**絕不**（在 dirty working tree）：
- `git checkout .` / `git restore .`
- `git reset --hard`
- `git clean -fdx`
- `git stash drop`
- `git branch -D`（未合併分支）
- `git push --force`（主分支）
- `git rebase`（已 push 的 commits）

**防護層**：`c:/workspace/tools/git-guard-hook.sh` PreToolUse hook 硬擋。不嘗試繞過。

**批次修改失敗時**：
- ❌ 不要 `git checkout .` / `git reset --hard` 「回乾淨狀態重來」— 會清 untracked 檔（如 `.env`）
- ✅ 逐個修 / 真的要放棄改動 → **停下來回報使用者**

### 6.3 瀏覽器測試派 Sub-session（不主場景自跑）

**主場景不自跑瀏覽器驗證 — 派 sub-session 做。**

理由：
- `take_snapshot` 每個回傳 ~15k+ tokens；4-5 個 snapshot = 60-80k tokens，直接吃掉主場景接近整個 session 的 ctx 餘量
- 主場景 ctx 用盡後接手成本極高（下個 session 要重讀必讀 + topic 歷史）
- Sub-session ctx 獨立，瀏覽器驗證跑完就釋放

**做法**：
- P8 / P_ 瀏覽器驗證 Phase → 派 sub-session 接手驗
- 若沒 sub-session 可派 → 請使用者自己跑（而非主場景自跑）
- Sub-session 內部用 chrome-devtools MCP（`list_pages` / `take_snapshot` / `click` / `fill` / `evaluate_script` 等）

**Sub-session 跑瀏覽器的紀律**：
- `take_snapshot` ~15k tokens / 個 — 只在關鍵決策點用
- 優先用 `evaluate_script`（返 JSON 較精簡）
- `list_console_messages` 小成本多用
- **API 旁路驗資料層**（在 UI 測試前先 fetch API 看 response，判斷是資料 / UI 哪層問題）

### 6.4 多 Session Git Working Tree Race

N 個 sub-session 並行改同 repo，各自看到其他 session 的未 commit WIP → 誤 add / 誤 commit。

**對策**：
- 發包 prompt 明寫 pathspec 嚴格限定 X / Y / Z
- `git-guard-hook.sh` 廣義 add 警告
- 根本：各 sub-session 獨立 git worktree（成本高、不一定值得）

---

## §7 版本

- v0.1 — 2026-04-21 建立初版（整合 multi-session-dispatch §一~六 + main-session-handoff §二/§五/§六 + workspace CLAUDE.md Minitor 段 + 3 份協作 memory 全內容）
- v0.2 — 2026-04-22 §7 接力交接段拆出（交接機制移到各專案 `docs/ai-session-handoff/main-scene-playbook.md`，本檔只含協作）
- v0.3 — 2026-04-22 §6.1 擴充 cross-repo race 對策：使用者 gate-keep 作為現行解 + mmsg lock 列未來 TODO；點明「session 時間感知滯後」是根本問題
