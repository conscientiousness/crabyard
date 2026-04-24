<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/crabyard-logo-lockup-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./docs/assets/crabyard-logo-lockup-light.png">
    <img src="./docs/assets/crabyard-logo-lockup-light.png" alt="Crabyard" width="420">
  </picture>
</p>

<p align="center">
  <strong>讓 coding agents 跟著專案一起持續進化</strong>
</p>

<p align="center">
  <a href="https://github.com/conscientiousness/crabyard/actions/workflows/ci.yml?branch=main">
    <img src="https://img.shields.io/github/actions/workflow/status/conscientiousness/crabyard/ci.yml?branch=main&style=for-the-badge" alt="CI status">
  </a>
  <a href="https://www.npmjs.com/package/crabyard">
    <img src="https://img.shields.io/npm/v/crabyard?style=for-the-badge" alt="npm version">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License">
  </a>
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="./README.zh-TW.md">繁體中文</a>
  ·
  <a href="#安裝">安裝</a>
  ·
  <a href="#快速開始">快速開始</a>
  ·
  <a href="#cli-指令">CLI 指令</a>
</p>

## 安裝

如果你是直接使用已發佈的 CLI，先安裝：

```bash
npm install -g crabyard
```

如果你不想做全域安裝，也可以直接用：

```bash
npx crabyard@latest --help
```

## 快速開始

安裝完成後，可以先從這幾個指令開始：

```bash
crabyard init /absolute/path/to/repo
crabyard validate --repo /absolute/path/to/repo
crabyard status --repo /absolute/path/to/repo
crabyard status add-auth --repo /absolute/path/to/repo --json
crabyard check add-auth --repo /absolute/path/to/repo
crabyard verify add-auth --repo /absolute/path/to/repo
crabyard sync add-auth --repo /absolute/path/to/repo
crabyard archive add-auth --repo /absolute/path/to/repo
```

CLI 升級後，如果要把既有 repo 中的 repo-local managed assets 更新到最新版，可以執行：

```bash
crabyard refresh .
```

`refresh` 會刷新像 repo-local skills 與 `AGENTS.md` managed routing block 這類可安全替換的資產，並把目前安裝的 CLI 版本寫進 `crabyard/manifest.yaml` 的 `managed_by.crabyard_version`。`project.md`、`knowledge/index.md`、`TASK_EXECUTION_FORMAT.md`、各 bucket 的 `README.md` 這些 repo 自己會持續維護的文件會被保留，只有缺檔時才補回。舊的 `update` 指令仍保留為 alias。

只有在你真的想把被取代的 managed files 複製到 `.crabyard/backups/` 時，才加上 `--backup`。

如果 repo 原本已經在使用 OpenSpec，可以直接把既有 spec 與 change bundle 遷移進 Crabyard：

```bash
crabyard migrate openspec /absolute/path/to/repo
```

這個指令會保留原本的 `openspec/` 目錄，並把支援的內容複製到 `crabyard/`，同時替遷移過來的 change bundle 產生可用的 `execution.yaml` 佔位檔。

第一次上手，大概會走這樣一輪：

1. `crabyard init /absolute/path/to/repo`
2. 要求你的 agent 工具建立 `crabyard/changes/<slug>/`
3. 讓 agent 撰寫 `proposal.md`、`design.md`、`tasks.md`、`execution.yaml`
4. 執行 `crabyard validate change <slug> --repo /absolute/path/to/repo`
5. 讓 agent 使用 `crabyard status <slug> --repo /absolute/path/to/repo --json`
6. 從目前可開始的單元開始實作
7. 執行 `check`、`verify`、`sync`、`verify`、`archive`

如果你偏好 `npx`，把上面範例裡的 `crabyard` 換成 `npx crabyard@latest` 就可以了。

任何支援專案內 Skills 的 agent 工具都可以用這套流程。

Crabyard 的出發點其實很單純：當你開始認真讓 agent 幫你開發時，真正困難的通常不是讓它把程式寫出來，而是讓整個專案在一次又一次工作階段之後，仍然保持清楚。

任務會和實際執行脫節。已接受的產品行為會和草稿想法混在一起。審查找出的問題會在回合切換之間消失。過幾天之後，程式也許還在，但大家對於什麼做完了、什麼卡住了、什麼能安全修改，已經沒有乾淨的共識。

Crabyard 想做的，就是在這件事變成常態之前，把這種失真壓住。它在專案裡放進一層很小但很穩的結構，讓 agent 有固定的地方可以看規劃、執行事實、已接受的產品事實，以及可長期保留的實作知識，而不是把工作記憶散在聊天內容裡。

具體來說，它把下面幾件事分開：

- 人類可讀的任務規劃：`tasks.md`
- 機器可檢查的執行事實：`execution.yaml`
- 已接受的產品事實：`crabyard/specs/`
- 進行中的已接受事實修改：`crabyard/changes/<slug>/specs/`
- 可長期保留的實作與除錯知識：`crabyard/knowledge/`

因此，搭配 agent 的開發會變成比較乾淨的循環：

```text
你 -> 要求你的 agent 工具做一個改動
   |
   v
crabyard 變更包
   |
   v
agent 讀 `proposal.md`、`design.md`、`tasks.md` 與 `execution.yaml`
   |
   +--> status --json 告訴它：
   |      - 現在什麼可以開始
   |      - 什麼被阻擋
   |      - 哪些驗證項目重要
   |
   v
agent 一次只實作一個安全單元
   |
   v
verify
   |
   +--> 如果 staged specs 有變更：sync -> 再驗證
   |
   v
archive
   |
   v
到下一次工作階段，專案還是清楚一致
```

重點不是為了寫文件而寫文件，而是讓 agent 在下面這些事情上更可靠：

- 規劃與審查改動
- 理解執行順序與可並行區段
- 強制寫入所有權
- 表達驗證規則
- 同步已接受的產品事實
- 保留可重用知識

最關鍵的設計點，是把明確的執行圖放進 `execution.yaml`。`tasks.md` 依然保持給人閱讀，而排程、依賴、寫入所有權與驗證資料則保持可被機器檢查。

Crabyard 的靈感有一部分來自 Compound Engineering 和 OpenSpec。差異主要在範圍：Crabyard 刻意做得更小，把上下文盡量留在專案裡，並專注在一套更容易跟著專案一路演進的執行規範。

## 工作流程

這套流程刻意改成兩層模型：核心主線保持短，其他步驟則視情況作為 helper 使用。

```text
探查 -> 規劃 -> 實作 -> 驗證 -> 結案
```

條件式 helper：

- 在 explore、plan、review 的重大決策前先做 knowledge retrieval
- 當風險、模糊處或 review 發現值得先擋下來時，把 review 當成 apply 前或結案前的 optional gate
- 只有 staged specs 真的改變 accepted truth 時，才執行 `sync` 並再驗證一次
- 只有 durable knowledge 需要更新時，才執行 `learn` 或 `refresh`

- `AGENTS.md` 是專案的正式指引檔
- 已接受的產品事實放在 `crabyard/specs/`
- 進行中的產品事實修改放在 `crabyard/changes/<slug>/specs/`
- 可長期保留的實作與除錯知識放在 `crabyard/knowledge/`

## 初始化後會多出什麼

執行 `init` 之後，專案會多出這些結構：

```text
<repo>/
  AGENTS.md
  .agents/skills/
    crabyard-research/
    crabyard-explore/
    crabyard-plan/
    crabyard-apply/
    crabyard-review/
    crabyard-archive/
    crabyard-debug/
    crabyard-learn/
    crabyard-refresh/
  crabyard/
    manifest.yaml
    project.md
    TASK_EXECUTION_FORMAT.md
    specs/
    changes/
    knowledge/
      index.md
```

## 一個變更會長什麼樣子

每個進行中的變更，都建議長這樣：

```text
crabyard/changes/<slug>/
  proposal.md
  design.md
  tasks.md
  execution.yaml
  specs/
```

- `execution.yaml` 一定要有
- `specs/` 是已接受規格更新的暫存來源

## Crabyard 會檢查什麼

Crabyard 的判斷原則其實很直白：`execution.yaml` 不能只是看起來像對的，它要真的成立，而且要和人會看的 `tasks.md` 對得上。這樣 agent 看到的執行範圍才值得相信。

`execution.yaml` 會用真正的 YAML 解析器解析，並用 schema 驗證。

Crabyard 會直接拒絕下面這些情況：

- 欄位結構不合法
- 未知的 `depends_on`
- 依賴循環
- 重複的單元 id
- 重複的單元標題
- 缺少 `parallel`、`writes` 或 `verify`
- 對於可同時執行的 `parallel: true` 單元，如果 `writes` 互相重疊，而且沒有全部明確設定 `allow_parallel_write_overlap: true`
- `tasks.md` 的頂層 `##` 區段和 `execution.yaml` 單元不一致

`tasks.md` 與 `execution.yaml` 必須一對一且順序一致。

`writes` 使用寫入所有權規則：

- 精確路徑：`src/execution.ts`
- 子樹：`src/` 或 `src/**`
- glob：`src/**/*.ts`、`docs/{api,guide}.md`、`src/*/index.ts`

重疊檢查會看路徑區段，因此 `src/*.ts` 與 `src/*.md` 可以平行執行，但 `src/` 仍然會阻擋任何巢狀檔案寫入所有權。

`verify` 現在接受有明確型別的描述，以及舊式字串簡寫：

- command：`kind`、`run` 或 `argv`，以及可選的 `cwd`、`timeout_ms`、`expect_exit_code`
- artifact：`kind`、`path`，以及可選的 `state`

舊格式 `verify: [pnpm test]` 仍然有效，並會正規化成指令檢查。

如果你想真的執行這些正規化後的檢查，請使用 `crabyard check <change>`。

## 真正重要的幾個指令

CLI 本身刻意做得很小。對 agent 來說，真正常用的其實就是這幾個指令，而其他東西只是替這個流程補上護欄：

- `crabyard validate`：拒絕壞掉的專案或變更結構
- `crabyard status --json`：檢視專案狀態、變更狀態、目前可執行範圍與驗證摘要
- `crabyard check`：實際執行變更裡正規化後的 verify metadata
- `crabyard verify`：執行可預測的結案前檢查
- `crabyard search`：快速搜尋已編譯的 repo 知識層
- `crabyard lint knowledge`：檢查知識索引漂移與 metadata 問題
- `crabyard sync`：把暫存的已接受事實更新同步到正式規格
- `crabyard archive`：只有通過驗證且同步一致的變更才能結案

整體設計很單純：skills 保持精簡，CLI 保持權威。

## 放進真實工作階段裡會怎麼用

你可以把 Crabyard 想成是放在一般 agent 工作流程旁邊的一層共享工作記憶與執行規範。真正改變的是：專案本身終於有地方可以把規劃、執行範圍與結案條件說清楚。

典型使用方式：

```text
1. 你要求你的 agent 工具做一個功能或修復
2. agent 建立或更新 `crabyard/changes/<slug>/`
3. agent 讀 `tasks.md` 與 `execution.yaml`，而不是自己猜執行順序
4. agent 用 status --json 決定目前什麼可以開始
5. agent 根據明確的關卡進行實作、審查、驗證、同步與結案
```

實際互動通常像這樣：

```text
你：新增 OAuth 登入
  |
  v
Agent:
  - 建立變更包
  - 撰寫 `proposal.md`、`design.md`、`tasks.md` 與 `execution.yaml`
  - 檢查 status --json
  - 只執行目前可開始的單元
  - 每一步後重新檢查 status
  - 最後用 verify/sync/archive 結案
```

## CLI 指令

- `init`：在專案裡建立 Crabyard 所需的基礎結構
- `install`：`init` 的別名
- `refresh`：更新既有 repo 中可安全替換的 managed assets，同時保留 repo 自己維護的文件
- `update`：`refresh` 的別名
- `migrate`：把 OpenSpec 的 spec 與 change bundle 複製進 Crabyard
- `list`：列出專案裡目前有哪些變更
- `show`：把單一變更包的內容印出來查看
- `validate`：在繼續工作前檢查專案或變更結構是否正確
- `status`：查看專案狀態、變更狀態與目前可執行範圍
- `check`：執行變更中正規化後的 verify checks
- `verify`：替變更執行結案前的檢查關卡
- `search`：搜尋 `crabyard/knowledge/`，並可選擇納入 `crabyard/specs/`
- `lint`：目前支援 `lint knowledge`，用來檢查編譯後的知識層
- `sync`：把已接受規格的更新同步到正式規格
- `archive`：把已驗證且同步一致的變更正式結案

### `validate [repo]`

`validate` 會在工作繼續前，先檢查整個 repo 或單一 change bundle 是否結構正確。

- 不帶額外 target 的 `validate` 會檢查 repo 結構、managed memory block，以及所有進行中的 changes
- `validate change <name>` 會只檢查單一 change bundle
- 文字與 JSON 輸出現在都會包含 managed-assets version 狀態，方便在驗證時直接看到 repo-local skills 或 routing assets 是否落後於目前安裝的 CLI

### `check <change>`

`check` 是把 typed `verify` metadata 真的執行起來的地方。它會跑正規化後的 command / artifact checks，並回報每個 unit 的結果。

和 `verify` 不同，`check` 不要求 `tasks.md` 必須先全部勾完。它主要是拿來在開發進行中執行真實檢查。

### `verify <change>`

你可以把 `verify` 想成結案前的守門員。

它會驗證變更包、檢查 `execution.yaml` 是否可信，並在 `tasks.md` 仍有未勾選項目時失敗。

它不會執行 `execution.yaml` 中 `verify` 陣列裡的任意 shell 指令。

### `status [change]`

這通常會是 agent 最常讀的指令，而且它也是唯讀的。

- `status` 不帶 change 時，會摘要專案是否有效、各種計數，以及進行中變更的狀態
- `status <change>` 會摘要任務完成度、可開始的單元、被阻擋的單元、驗證缺口、同步準備狀態，以及目前可執行範圍
- `status` 也會回報 repo-managed assets 是否和目前安裝的 CLI 版本一致；不一致時會直接給 refresh 提示
- `--json` 會回傳適合 agent 工具鏈使用的機器可讀輸出
- `status --json` 目前包含 `managedAssets`、`frontier.readyUnits`、`frontier.blockedUnits` 與 `verification.summary`

範例：

```bash
crabyard status add-auth --repo /absolute/path/to/repo --json
```

典型 JSON 欄位：

- `managedAssets`
- `state`
- `units.items`
- `frontier.readyUnits`
- `frontier.blockedUnits`
- `verification.summary`
- `sync.pending`

### `sync <change>`

`sync` 做的事情很單純：把這次變更裡已經準備好的規格更新，從：

```text
crabyard/changes/<slug>/specs/
```

同步到：

```text
crabyard/specs/
```

同步行為刻意設計得比較保守，目的是避免 agent 太早把還沒收斂好的內容當成正式事實：

- 變更必須先通過 `crabyard verify <change>`
- 暫存中的檔案會被複製或覆寫到正式規格
- 暫存中不存在的檔案不會從正式規格刪除
- 檔案處理順序是可預測的

### `archive <change>`

`archive` 不只是單純改個名字。

只有在以下條件成立時才會成功：

- `verify` 通過
- 暫存規格與正式規格一致

比較穩的結案順序是：

1. `crabyard verify <change>`
2. 若需要，執行 `crabyard sync <change>`
3. 再執行一次 `crabyard verify <change>`
4. `crabyard archive <change>`

## 內建 Skills

Crabyard 會在 `.agents/skills/` 下安裝一組很小的專案內 skills。任何支援專案內 Skills 的 agent 工具都可以直接使用。這是刻意的。你應該可以複製一個專案、跑完 `init`，然後立刻給 agent 同一套小而穩的工具，而不是還要依賴某個人的全域安裝。

- `crabyard-research`
- `crabyard-explore`
- `crabyard-plan`
- `crabyard-apply`
- `crabyard-review`
- `crabyard-archive`
- `crabyard-debug`
- `crabyard-learn`
- `crabyard-refresh`

這些 skills 都只活在專案裡。知識檢索不是附加功能，而是工作流程的一部分。

- `crabyard-research` 會搜尋 `crabyard/knowledge/index.md`、`crabyard/knowledge/` 與相關規格，找出最有價值的既有知識
- `crabyard-explore`、`crabyard-plan` 與 `crabyard-review` 都會先做一次明確的檢索
- 取回的知識會影響決策，但不會凌駕於 `crabyard/specs/` 中已接受的產品事實
- `crabyard-review` 可以在 `apply` 前先壓測規劃，也可以在 `apply` 後審查實作

可重用的審查層放在 `crabyard-review`，會一起看：

- 程式碼
- `proposal.md`
- `design.md`
- `tasks.md`
- 執行規劃
- 相關規格

它會用 `P1 / P2 / P3` 輸出優先級。只有需要長期保留審查結果時，才把它寫成檔案。

## 知識如何持續有用

Crabyard 把可長期保留的實作與除錯筆記放在 `crabyard/knowledge/`，但目的不是為了累積筆記，而是讓下一次工作比上一次更容易。

- `crabyard-research` 在規劃、審查或除錯前回傳最強的 1-3 個既有學習
- `crabyard-learn` 在建立知識筆記前會檢查重疊，並更新 `knowledge/index.md`
- `crabyard-refresh` 支援有範圍的更新、整併、替換、標記過時，以及保守的舊 repo 知識整理
- 可選的筆記 frontmatter 可以加上 `kind`、`tags`、`aliases`、`concepts`、`paths`、`related_specs`、`related_changes`、`supersedes` 與 `last_verified_at`
- `knowledge/index.md` 保持適合檢索，而且維持單一正式版本

既有 repo 先執行 CLI 指令 `crabyard refresh <repo>` 更新 repo-local managed skills。這個指令不會重寫 repo 自己維護的 knowledge。若舊知識需要整理，再用 `crabyard-refresh` skill 搭配窄範圍，讓 agent 只更新已經過時或重複的 retrieval target。
