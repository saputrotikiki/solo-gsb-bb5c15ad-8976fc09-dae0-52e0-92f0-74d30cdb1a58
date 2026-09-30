# 展馆多语展签审校 Web 应用

面向展馆的多语展签翻译—校对—发布流程系统。馆员维护中文原文与目标语言；译者逐条提交译文；另一名校对者确认；**同一账号不得确认自己的译文**。全部译文对应当前原文、全部确认后，馆员才能发布**不可变语言快照**；游客页只展示每种语言的最新已发布快照。

技术栈：**Python 3.12 / FastAPI + SQLite（WAL）+ 原生 HTML/CSS/JavaScript**，无前端构建步骤。

## 一键启动

```bash
docker compose up -d --build
```

首次启动自动：安装依赖、创建数据库表、初始化 3 个本地账号、2 种目标语言和 3 条示例中文展签。数据持久化在 Docker 命名卷 `exhibit-data` 中。

停止：

```bash
docker compose down          # 保留数据
docker compose down -v       # 同时删除数据库卷（慎用）
```

## 访问地址与端口

| 入口 | 地址 | 说明 |
|---|---|---|
| 登录 / 工作台 | http://localhost:8000/ | 已登录进入工作台，未登录跳转登录页 |
| 游客页（无需登录） | http://localhost:8000/visitor | 展示各语言最新已发布快照，未发布语言显示“暂无内容” |
| OpenAPI 文档 | http://localhost:8000/docs | 接口调试文档 |

端口映射在 `docker-compose.yml` 中为 `8000:8000`，如端口被占用可改成 `"8080:8000"`。

## 默认账号（本地账号）

| 角色 | 账号 | 密码 | 权限 |
|---|---|---|---|
| 馆员 librarian | `librarian` | `lib123` | 新增/修改中文原文、新增语言、发布语言快照、撤展/复展展签 |
| 译者 translator | `translator` | `tra123` | 提交/修订译文、可确认**他人**译文 |
| 校对 reviewer | `reviewer` | `rev123` | 确认译文、也可提交/修订译文 |

> 译者与校对者都能提交译文和确认译文，二者形成交叉审校：**确认人 ≠ 提交人** 是硬性服务端校验，自己提交的译文必须换账号确认。演示“禁止自审”可用 `translator` 提交后，再换 `reviewer` 登录确认。

## 配置（环境变量）

在 `docker-compose.yml` 或启动前的环境 / `.env` 中配置，**仅在数据库首次初始化时生效**：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DB_PATH` | `/data/exhibit.db` | SQLite 文件路径 |
| `SEED_LIBRARIAN_PW` | `lib123` | 馆员初始密码 |
| `SEED_TRANSLATOR_PW` | `tra123` | 译者初始密码 |
| `SEED_REVIEWER_PW` | `rev123` | 校对初始密码 |

## 工作流程与修订号规则

1. **原文修订号** `source_rev` 从 1 起递增；**译文修订号** `trans_rev` 同样从 1 起递增。
2. **修改原文**（即使又改回原来的字句）：`source_rev +1`，该展签所有语言译文的确认立即失效，看板状态变为「过期」，须译者据新原文重新提交、再由他人确认。
3. **提交 / 修订译文**：`trans_rev +1`，确认清除（回到「待审」），并记录所对应的原文修订号。
4. **乐观并发控制**：提交译文须携带读取时的 `source_rev`（修订时还须携带 `trans_rev`）；确认须携带双修订号。服务端比对不一致即返回 `409` **拒绝并保留现状**，前端提示刷新重试。
5. 看板按语言分四类统计：**待译 / 待审 / 过期 / 已确认**，并实时给出不可发布原因清单（缺译文、译文过期、待确认等）。
6. **发布**：仅当该语言全部展签均有译文、译文对应当前原文修订号且全部已确认，馆员才能发布。快照带递增版本号，以 JSON 整体落库，系统不提供修改/删除接口——**一经发布即不可变**。之后原文/译文再变动，只影响下一版，游客页继续显示旧快照直到发布新版。

## 撤展 / 复展（本轮新增）

馆员可对展签执行**撤展**与**复展**；展签有独立的**状态版本** `status_version`（从 1 起，每次撤展/复展 +1，与原文修订号互不影响），作为乐观锁。

### 行为约定

- **撤展**须携带展签编号、读取时的 `status_version` 与撤展**原因**：
  - 立即从**所有语言**的游客最新发布内容中隐藏该展签（快照 JSON 本身不可变，只在游客读取时过滤）；
  - **历史快照内容不变**，已登录用户通过快照查询接口看到的内容也不变；
  - 撤展展签**不计入**语言看板的待办统计与发布条件，也**不写入**后续发布的新快照；撤展期间禁止提交/确认译文；
  - 工作台显示撤展状态、原因、操作者、时间，并保留撤展/复展审计流水。
- **无在展展签时拒绝发布**（`409`，阻断原因中说明“当前无在展展签”）。
- **复展**按编号 + `status_version` 执行：**保留译文文本，但清除该展签各语言译文的确认**。复展后游客**仍看不到**该展签——直到对应语言译文按当前原文**经他人重新确认并发布新快照**（发布动作才解除该语言的游客隐藏）。
- 明确拒绝且**不改变任何数据**的情况：状态版本过期 / 重复撤展或重复复展 → `409`；非馆员操作 → `403`；展签编号无效 → `404`；撤展原因为空 → `422`。
- 撤展/复展与并发的原文修改、译文提交、审校确认、发布共享同一串行写锁，按一致状态处理（后到的过期请求一律拒绝）。

### HTTP API 与调用示例

所有写接口均需馆员会话 Cookie（登录 `/api/login` 后自动携带）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/labels/{id}/withdraw` | 撤展，body：`{"status_version": n, "reason": "..."}` |
| POST | `/api/labels/{id}/restore` | 复展，body：`{"status_version": n}` |
| GET | `/api/labels` | 展签列表（含 `display_status` / `status_version` / 撤展原因、操作者、时间） |
| GET | `/api/labels/{id}/status-events` | 撤展/复展流水（状态、原因、操作者、时间） |
| GET | `/api/board/{lang_id}` | 语言看板：在展展签统计 + `withdrawn_items` 已撤展区块 |
| GET | `/api/public/languages` | 游客接口（无需登录）：撤展展签从最新快照 `entries` 中过滤，字段约定不变 |

`display_status` 取值：`on_display`（在展）/ `withdrawn`（已撤展）。

```bash
# 1) 馆员登录（会话写入 cookie.txt）
curl -c cookie.txt -X POST http://localhost:8000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"librarian","password":"lib123"}'

# 2) 读取展签列表，拿到编号与 status_version
curl -b cookie.txt http://localhost:8000/api/labels

# 3) 撤展 #1（编号 + 状态版本 + 原因）
curl -b cookie.txt -X POST http://localhost:8000/api/labels/1/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"status_version":1,"reason":"文物外借，临时撤展"}'
# -> 200 {"id":1,"display_status":"withdrawn","status_version":2,"withdrawn_reason":"...", ...}

# 4) 游客接口立即隐藏该展签（历史快照内容不受影响）
curl http://localhost:8000/api/public/languages

# 5) 撤展/复展流水
curl -b cookie.txt http://localhost:8000/api/labels/1/status-events

# 6) 复展（须携带最新 status_version；译文保留、确认清除，游客须等新快照）
curl -b cookie.txt -X POST http://localhost:8000/api/labels/1/restore \
  -H 'Content-Type: application/json' -d '{"status_version":2}'
```

典型拒绝响应：

```text
409 状态版本已过期（服务器状态版本 2，请求基于 1），请刷新后重试
409 该展签已处于撤展状态，请勿重复撤展
409 当前无在展展签（N 条已撤展），无法发布
403 当前角色无权执行该操作
404 展签编号无效：不存在该展签
422 撤展原因不能为空
```

### 工作台操作位置

- 馆员登录后，在「中文原文展签」卡片：在展展签每条都有**撤展**按钮（展开后填写原因并确认）；已撤展展签集中显示在下方，可**复展**或查看**撤展/复展记录**。
- 各语言看板新增「**已撤展展签**」区块（含原因/操作者/时间），统计区新增「已撤展」数量；馆员也可在此直接复展。
- 游客页：撤展展签立即消失；某语言快照条目被全部撤展时显示“当前无在展展签”。

## 本地无 Docker 运行（开发）

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DB_PATH=./exhibit.db uvicorn app.main:app --reload
```

## 目录结构

```
app/
├── db.py                 # 连接/Schema/默认数据初始化（账号、语言、示例展签）
├── main.py               # FastAPI 全部接口、鉴权、看板聚合与发布逻辑
└── static/
    ├── login.html        # 登录页
    ├── app.html/app.js   # 审校工作台（按角色显示操作）
    ├── visitor.html      # 游客公开页
    └── styles.css
Dockerfile
docker-compose.yml
requirements.txt
```
