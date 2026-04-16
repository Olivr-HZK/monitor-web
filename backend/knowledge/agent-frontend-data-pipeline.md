# 前端数据加载与 `/api/data`（给 Agent / 维护者）

## 结论先说

- **登录后**，浏览器通过 **`GET /api/data/{相对路径}`** 拉取 **`public/`** 下**任意**资源（`.db`、子目录下 CSV/MD、图片等），路径解析后必须落在 `PUBLIC_DIR` 内；禁止 `..`、禁止以 `.` 开头的文件名；**`auth-config.json` 的 basename 不通过该接口返回**（见 `config.DATA_SERVE_DENYLIST_BASENAMES`）。
- **不再**使用「根目录文件名白名单 + 子目录前缀白名单」；新增数据库或静态资源时**无需**改后端配置（除非要收紧策略）。
- 前端 `AuthContext.getDataUrl(filename)`：静态托管时拼 `BASE_URL + 路径`；**后端模式**时拼 `getApiUrl('/api/data/' + encodeURIComponent(filename))`，请求带 Cookie。

## 前端入口

- `src/context/DataContext.tsx`：集中 `Promise.all` 加载各 loader；各 loader 接收 `getDataUrl`（或 `undefined` 表示用相对路径字符串）。
- 典型 loader：`src/data/sensortowerTopLoader.ts`、`src/data/ourProductDailyLoader.ts`、`src/data/reportsLoader.ts` 等，内部用 **sql.js** `fetch(getDataUrl('xxx.db'))` 或拉 JSON/CSV。

## 服务端 AI 工具 `query_sqlite`（与 HTTP 分离）

- 定义见 `backend/ai_tools.py`：`db` 参数**只能是 `public/` 根目录下的文件名**（不允许子路径），且为只读 `SELECT` / `WITH` / `PRAGMA table_info`。
- 新增根目录 `.db` 后，Agent **无需**改白名单即可用工具读库；若库在子目录，工具当前不支持，需复制或改工具逻辑（另议）。

## 修改 `/api/data` 策略时

- 收紧：在 `DATA_SERVE_DENYLIST_BASENAMES` 或 `serve_data` 内增加规则。
- 排查 404：先确认用户已登录、`public/` 下文件存在、路径与前端 `getDataUrl` 传入字符串一致。
