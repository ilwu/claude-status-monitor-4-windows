---
status: active
created: 2026-04-22
purpose: main-scene-handoff-playbook
---

# 原主場景交接 Playbook

> 本檔**只給原主場景讀**，整合交接全流程 SOP + 各階段範本。
> 原主場景按階段**消化 + 客製化** → 產出給新場景的指派 prompt。
> 新場景不開本檔。

---

## 核心原則

1. **範本 ≠ 指派**：本檔範本是原主場景素材，不是直接貼給新場景
2. **AI 價值在消化**：客製化融入本輪情境，不只轉貼
3. **分片保護**：新場景只看當下指派，不知道「有階段 2/3/4/5/6」這種結構
4. **主場景 ctx 曲線**：階段 0 重度消化、1-6 輕度指派、7 脫手
5. **探索紀律**：graphify → agent → Grep / Read
6. **暫存檔**：系統 `/tmp/`（見 workspace CLAUDE.md）

---

## 階段總覽

| 階段 | 主題 | 主場景負擔 |
|---|---|---|
| 0 | 脫手前：inbox 盤點 / close / 首訊息 + 起始 prompt | **重度** |
| 1 | 新場景讀資訊 | 等回報 |
| 2 | 新場景自檢 | 中度（寫題目）|
| 3 | 新場景 graphify 自救 | 輕度（短指派）|
| 3.5 | Dead-end 分類 + 回寫目的地分配（條件） | 輕度（分類表）|
| 4 | 使用者對齊 | 一句話 |
| 5 | 讀 PLAN + 對齊藍圖 | 一句話 |
| 6 | 正式接手 | 一句話 |
| 7 | 脫手 | — |

---

## 階段 0 — 脫手前

**觸發**：ctx ≥ 90%（dispatch-reviewer hook 強制） / 使用者明示

**範圍注意**：若主場景沒有業務 topic 在推進（純討論 / 純文件修改 session），0.1-0.4 可略，直接從 0.5 開始（close 舊交接 topic + 建新）。

### 0.1 列 inbox

```bash
MMSG=C:/workspace/tools/mmsg.cmd
$MMSG topic-inbox
```

列分類表（awaiting / in_flight + **每個 topic 的任務說明對齊 PLAN**）→ 給使用者看。

### 0.2 拍板 close / 繼續

對話，使用者判斷：已完成 → close / sub 已 die → close / 繼續推進 → 保留。

### 0.3 Close 不繼續的

```bash
for id in t-xxx t-yyy ...; do
  curl -sS -X POST "http://127.0.0.1:19823/api/topics/$id/close" -o /dev/null -w "closed $id\n"
done
```

### 0.4 對繼續 topic 派 sub 更新 summary

- 派 sub（mmsg topic-add 指派）
- Sub 產草稿（Phase 線 / 決策 / 偏離 / 技術關鍵 / 未完）
- 原主場景**審查**（可補本輪重大成果 / 特殊交接點）
- `mmsg topic-set-summary <topic-id> --author=main-scene` 回寫

### 0.5 Close 上輪交接 topic + 建新（首訊息即完整指令）

**核心精神**：首訊息**不給答案** — 告訴新場景「你什麼都沒有 → 必須讀懂文件」。
業務視角 / 重大產出 / 特殊情境 → **讓新場景從原始文件讀出來**，不是首訊息包好餵。

```bash
# 1. Close 舊交接 topic
curl -sS -X POST "http://127.0.0.1:19823/api/topics/<old-handoff-topic>/close"

# 2. 準備首訊息（主場景消化產出，寫到暫存檔）
cat > /tmp/first-message.md <<'EOF'
## 主線交接 YYYY-MM-DD

你接手 Platform-BackendServer 新主場景。

**接手前置**：跑一次 graphify rebuild 更新程式碼圖譜（確保 graphify 查詢反映最新程式碼，而非舊快取）：

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

**你現在什麼都沒有**。必須讀懂以下文件才能繼續任務：

[必讀清單 — 主場景按當前任務切入客製化]
- [專案 CLAUDE.md]（例：Platform-BackendServer/CLAUDE.md）
- claude-status-monitor-4-windows/docs/session-handoff/examples/business-derivation.md（業務骨架範例 — 各專案正式使用時應有自己的版本）
- [專案 docs INDEX.md]（若有）
- [專案關鍵決策歸檔]（例：Platform-BackendServer/docs/audit/agent-commission_v2/DECISIONS.md；範例版：claude-status-monitor-4-windows/docs/session-handoff/examples/DECISIONS.md）
- claude-status-monitor-4-windows/docs/collab-framework/（README + 1/2/3 各一份）
- [其他按任務情境補：FUNC_DESIGN/XXXX.md 等]

**身分慣例**：你接手期間用 `--author=main-incoming`（預設 is_master=0）；階段 6「正式接手」後才改 `--author=main-scene --master`。

**回報紀律（保護主場景 ctx — 全程適用）**：
- 報**結果**，不報過程
- 結論式陳述，不複製長文件 / 長程式碼 / 對話逐字
- 列表用簡表，不展開細節
- **每批一次報**：分批任務做完整批再報，不要逐項報（除非遇阻塞需主場景立即介入）
- **新代號 / 縮寫附定義**：自造或局部代號（Wave 1 / N1 / 缺7 等）首次出現必須附一行定義（例：`Wave 1 = 階段 4 第一波對齊清單 P7/缺1/缺2/缺7`）
- 主場景 ctx 有限 — 詳細過程留在 topic thread，主場景要細節會單獨問 / `topic-show` 自取

讀完回報使用者「你理解了什麼」（精簡），並將理解回報主場景（mmsg topic-add），等下一步指派。
EOF

# 3. 建新 topic，首訊息作為第一條 message
TOPIC=$(cat /tmp/first-message.md | $MMSG topic-new --title="交接 YYYY-MM-DD" --author=main-scene --master)
echo "$TOPIC"  # 記下給 0.6 起始 prompt 用
```

**規範**：
- 每次交接都 close 舊開新（context priming 效應 — 新場景看到舊失敗紀錄會消沉）
- **用 message 而非 summary 裝指令**：summary 的「全貌」容器會誘發 ctx 耗盡的主場景滑向「寫結構化後續步驟」（破壞分片保護）；message 的「下指令」語氣自然聚焦當下
- **首訊息即完整指令**：不再另寫 summary，省一份 ctx；新場景 `topic-show` 看時序訊息第一條即為起點

**禁止放進首訊息**：
- 「本輪重大產出」清單（新場景直接複製，不讀原文）
- 「業務視角」摘要（逼新場景從 business-derivation 讀出）
- 「特殊情境提醒」細節（逼他從對應文件讀出）
- **紀律細節**（探索順序 / 暫存檔 / 誠實標 等 — 這些在 CLAUDE.md / collab-framework 裡新場景會讀到）
- 具體任務 / inbox 狀態 / 後續步驟 / 工具名

**可放首訊息**：
- 必讀清單（告訴要讀什麼）
- 回報格式指示（「你理解了什麼」+ 回報主場景）

### 0.6 產起始 prompt（短 — 指向 topic）

**核心原則**：**mmsg 是內容通道，prompt 只是啟動指向**。

- 必讀清單 / 回報指示 → 全在 **topic 首訊息**（0.5 產出）
- prompt 只寫「接手身分 + topic id + 讀主場景首訊息」

**Prompt 範本（最小版）**：

```
你是 Platform-BackendServer 新接手的主場景。

MMSG=C:/workspace/tools/mmsg.cmd
$MMSG topic-show t-xxxxxxxx

照主場景發的首訊息做。
```

**原主場景客製化**：
- 要強調的特殊點 → **加進首訊息**，不加進 prompt
- 必讀清單等**全部放首訊息**

**禁止**：
- prompt 裡列必讀清單（應放首訊息）
- prompt 裡列紀律（應放首訊息）
- 列步驟編號 / 後續工具名（inbox / PLAN / 自檢 / 對齊）
- 劇透後續階段

### 0.7 給使用者

新 topic id + 起始 prompt。

---

## 階段 1 — 新場景讀資訊

主場景**不動作**，等使用者轉達「新場景讀完」。

---

## 階段 2 — 自檢（中度指派）

### 2.1 寫自檢指派 prompt

**範本骨架**：

```
你已讀完必讀。現在做自檢。

Q1 畫代理生命週期 + 佣金機制生命週期圖（含交會點）
  - 格式不拘（ASCII / Mermaid / 自由畫）
  - 畫不出的節點 / 箭頭 → 誠實標

Q2 畫系統設計哲學關係圖
  - 節點 = 原則，箭頭 = 推導 / 支撐 / 約束 / 實現
  - 必體現：職責邊界 → 去耦合 → 縮小思考範圍（ctx 節省）

Q3 擬 3 個業務面主從實做場景 + 推演
  - 從業務需求出發生成場景
  - 推演用現有工具（collab-framework + mmsg + hook + graphify）走會發生什麼
  - 暴露工具邊界 + 規範缺口

紀律：
- 誠實標疑點（推不通 / 不確定 / 沒想到）= 核心價值
- 用自己話 / 自己畫，不抄文件
- 探索：graphify → agent → Grep / Read

**Ctx 預算（避免自檢燒光接手 ctx）**：
- 每題 1000 tokens 內答完；精準畫圖不求全面；疑點條列不展開分析
- 階段 2 總上限 3000 tokens；超過停下標「暫停」讓主場景判斷

完成輸出 Q1/Q2/Q3 + 疑點清單 → 回報使用者。
```

**客製化**：
- 本輪有特殊業務焦點 → 加到 Q1 / Q2 重點
- Q3 可給情境方向（不給具體場景）

**預期收到**：Q1/Q2/Q3 輸出 + 疑點清單。

---

## 階段 3 — graphify 自救（短指派）

### 3.1 分析疑點 + 指派

**範本**：

```
針對疑點清單，對每項自救：

- 疑點 A（例：override chain HALL 終止細節）→ 用 graphify 搜尋「override chain HALL」關鍵字
- 疑點 B（例：某 facade 邊界）→ 不確定，用 graphify 搜尋看看
- 疑點 C（例：業務 why）→ 留給下一步（先 graphify 確認技術事實）

流程：
- graphify 找到 → 補對應 Q 內容
- 找不到 → 標「dead-end」
- 對齊理解後重新生成疑點清單

**紀律（ctx 保護）**：
- 自救不是全面掃描 — 找到答案 / 明確 dead-end 即可，不深挖
- 每項 1-3 次工具呼叫內結束；超過標「需更多 ctx 才能驗」
- 補 Q 內容精簡（「P4 結論 = XXX，Q1.X3 修正為 YYY」），不複製整段程式碼
- 階段 2 若深度高已燒 ctx，階段 3 更要節制 — 後面 4-6 才是接手工作的真正起點

回報：重新生成的清單（補掉的 + 剩 dead-end）。
```

**主場景判斷**：
- 技術 / 架構 → graphify 能解 → 指 graphify
- 業務 why / 判斷 → graphify 難解 → 留 dead-end
- 完全不確定 → 直指 graphify 探

**ctx 保護時機**：若階段 2 回報顯示新場景用力過猛（畫超完整圖 + 超多疑點），階段 3 指派要**明示節制條款**；若階段 2 已節制，這段可略。

**預期收到**：重新生成的清單（剩 dead-end）。

---

## 階段 3.5 — Dead-end 分類 + 回寫目的地分配（條件）

**何時做**：階段 3 回報顯示 dead-end 混多類（業務 why / 規範缺口 / 實作缺口）。若全同類可略，直接進階段 4。

### 3.5.1 分類表

主場景讀階段 3 回報 → 對每項 dead-end 標類別 + 回寫目的地：

| 類別 | 特徵 | 回寫目的地 |
|------|------|-----------|
| **業務 why** | 「為什麼這樣設計」「業務規則從哪來」 | `business-derivation.md` 對應段 |
| **規範缺口** | 流程 / 工具缺規範、需升級 | `ref/candidate-precedents.md`（候選）或升級 `collab-framework/` / `DECISIONS.md` |
| **實作缺口** | 文件訂了但程式沒實作 / bug | `PLAN.md`（TODO / BUG）或開 jira issue |

分類完在階段 4 指派中**明示每項類別 + 目的地**，子場景對齊後知道回寫哪裡。

**預期產出**：分類表（打包進階段 4 指派）。

---

## 階段 4 — 使用者對齊（一句話）

### 4.1 指派

```
針對 dead-end 清單，**你自己直接和使用者對齊**（不轉回主場景）：
- 你提問、使用者回答
- 追問到完全明白 — 自行判斷資訊充足再結束
- 對齊完把補到的理解**立即回寫**對應文件（用 Edit，不全覆蓋）

**回報主場景**：只報**結果**（dead-end 剩幾項 / 已回寫哪裡 / 重大決策變更 1-2 行）。
**不報**：對話過程 / 使用者原話逐字 / 長篇闡述。
```

**為什麼子場景直接對齊，不轉回主場景**：
- 主場景不是當事人，問不到核心
- 主場景 ctx 耗盡時判斷力下降，可能敷衍或錯亂
- 當事人追問效率最高
- 主場景 ctx 極省（過程留在 topic thread，主場景要看再 `topic-show`）

**主場景客製化時機**：
- **業務決策現場翻轉**：若對齊前使用者已告知業務決策變更（舊決策被推翻），主場景**先打包入指派** — 明示「舊 → 新 + 身分變更（決策 / TODO / BUG）」，不讓子場景在對齊中才被動發現
- **Dead-end 混類**：若階段 3.5 分類完，指派明示每項類別 + 回寫目的地（3.5 輸出的分類表直接搬入）

**預期收到**：結果摘要（3-5 行以內）。

---

## 階段 5 — 讀 PLAN + 對齊藍圖（一句話）

### 5.1 指派

```
讀 Platform-BackendServer/docs/audit/agent-commission_v2/PLAN.md，和使用者對齊當前 TODO 優先。
```

**預期收到**：工作藍圖 / TODO 優先序。

---

## 階段 6 — 正式接手（一句話）

### 6.1 指派

```
1. `mmsg topic-inbox` 掃所有活躍 topic
2. 逐個判斷繼續 / close（交接 topic 本身：完成使命可 close）
3. **身分切換**：從 `--author=main-incoming` 改為 `--author=main-scene --master`（正式接手）

回報：「正式接手」+ inbox 處理結果（X close / X 繼續）。
```

**預期收到**：「正式接手」+ inbox 結果。

---

## 階段 7 — 脫手

- 使用者確認新場景就位
- 原主場景退場（session 結束）

---

## 關鍵紀律彙總

### 資訊揭露（分片保護）

| 產出 | 含什麼 | 禁止 |
|---|---|---|
| 起始 prompt | 啟動指向（接手身分 + 指向首訊息）| 必讀清單 / 紀律（應放首訊息）/ 步驟編號 / 後續工具名 |
| Topic 首訊息 | 必讀清單 + 回報指示 | 業務摘要 / 重大產出 / 後續步驟 / 具體任務 / 紀律細節 |
| 各階段指派 | 當下動作 | 後續流程具體形式 |

### 主場景 ctx 管理

| 階段 | 負擔 |
|---|---|
| 0 | 重度消化（首訊息 + 起始 prompt 是核心產出）|
| 1 | 等回報 |
| 2 | 中度（寫題目）|
| 3 | 輕度（短指派）|
| 3.5 | 輕度（分類表，條件觸發）|
| 4-6 | 一句話 |
| 7 | 脫手 |

---

## 維護

- 實戰踩坑 / 新教訓 → 補入對應階段
- 範本變動 → 檢視客製化原則是否要更新
