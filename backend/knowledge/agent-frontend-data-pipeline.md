# 前端数据加载与 `/api/data`（给 Agent / 维护者）

## 结论先说

- **登录后**，浏览器通过 **`GET /api/data/{相对路径}`** 拉取数据。
- 根目录 canonical `.db` 优先走 `config.DATA_SOURCE_DB_PATHS` 映射到上游项目源库，并由后端按请求生成 SQLite backup 快照返回；这避免直接暴露正在写入/WAL 中的主库文件。
- 其它相对路径仍从 **`public/`** 下读取（子目录下 CSV/MD/JSON/图片等），路径解析后必须落在 `PUBLIC_DIR` 内；禁止 `..`、禁止以 `.` 开头的文件名；**`auth-config.json` 的 basename 不通过该接口返回**（见 `config.DATA_SERVE_DENYLIST_BASENAMES`）。
- 前端 `AuthContext.getDataUrl(filename)`：静态托管时拼 `BASE_URL + 路径`；**后端模式**时拼 `getApiUrl('/api/data/' + encodeURIComponent(filename))`，请求带 Cookie。

## 前端入口

- `src/context/DataContext.tsx`：集中 `Promise.all` 加载各 loader；各 loader 接收 `getDataUrl`（或 `undefined` 表示用相对路径字符串）。
- 典型 loader：`src/data/sensortowerTopLoader.ts`、`src/data/ourProductDailyLoader.ts`、`src/data/reportsLoader.ts` 等，内部用 **sql.js** `fetch(getDataUrl('xxx.db'))` 或拉 JSON/CSV。

## 服务端 AI 工具 `query_sqlite`（与 HTTP 分离）

- 定义见 `backend/ai_tools.py`：`db` 参数**只能是 canonical 数据库文件名**（不允许子路径），且为只读 `SELECT` / `WITH` / `PRAGMA table_info`。
- 新增源库优先改 `backend/config.py` 的 `DATA_SOURCE_DB_PATHS` 或对应环境变量；`public/*.db` 只作为兼容回退。

## 修改 `/api/data` 策略时

- 收紧：在 `DATA_SERVE_DENYLIST_BASENAMES` 或 `serve_data` 内增加规则。
- 排查 404：canonical `.db` 先看 `DATA_SOURCE_DB_PATHS` 对应源库是否存在；其它资源再确认 `public/` 下文件存在、路径与前端 `getDataUrl` 传入字符串一致。
