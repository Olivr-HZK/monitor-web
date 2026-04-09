# 在 Google Sites 上实现与当前静态站类似效果

当前站点是 React SPA，部署在 **GitHub Pages**（如 `https://olivr-hzk.github.io/monitor-web/`）。  
Google Sites 不能直接上传整站，但可以用 **iframe 嵌入** 的方式，在 Google Sites 里“套一层壳”，用户点进去看到的就是你现在的完整页面效果。

---

## 方案一：单页全站嵌入（推荐，最简单）

在 Google Sites 里做一个“入口页”，整页只放一个 iframe，指向你现有的站点，用户看到的效果和直接打开你的静态站几乎一致。

### 步骤

1. 打开 [Google Sites](https://sites.google.com) → 新建网站或编辑已有网站。
2. 添加一个**新页面**（例如命名为「监测汇总」或「看板」）。
3. 在页面上：
   - 点击 **插入** → **嵌入** → **嵌入网址**  
     或 **插入** → **嵌入** → **嵌入代码**。
4. **若用「嵌入网址」**：  
   - 输入你的站点地址，例如：  
     `https://olivr-hzk.github.io/monitor-web/`  
   - 保存。Google 会生成对应的嵌入块（内部通常是 iframe）。
5. **若用「嵌入代码」**（可控制高度、是否去边框）：  
   - 在代码框中粘贴下面这段，把 `你的实际地址` 换成上面的 URL：

```html
<iframe
  src="https://olivr-hzk.github.io/monitor-web/"
  title="监测汇总"
  width="100%"
  height="900"
  style="border: none; min-height: 90vh;"
></iframe>
```

6. 调整嵌入块大小：在编辑模式下拖动嵌入块四角，尽量拉满整页宽度，高度建议设大一点（如 900px 或 90vh），这样首页、侧栏、点进子页面都能在框内完整显示。
7. 点击右上角 **发布**。

### 效果与注意

- **效果**：用户打开 Google Sites 的该页面后，会看到你当前的整站（首页、导航、各监测类型、榜单、报告等），交互与现在一致。
- **登录**：若使用静态密码模式，登录在 iframe 内完成，一般没问题；若用后端校验，需注意 cookie/跨域策略是否允许在 iframe 内使用。
- **外观**：iframe 会有一个“框”，若希望更无边框，可把上面代码里 `height` 调大或使用 `min-height: 90vh`，并在 Google Sites 里尽量让嵌入块占满页面。

---

## 方案二：多页导航 + 每页嵌入不同路由（可选）

若希望 Google Sites 的左侧/顶部导航也参与进来（例如“首页 / AI 榜单 / 休闲游戏”都在 Sites 里有一项），可以：

1. 在 Google Sites 建多个子页面，例如：  
   - 监测首页  
   - AI 榜单  
   - 休闲游戏监测  
   - 热点监测  
2. 每个子页里用 **嵌入代码** 放一个 iframe，`src` 分别指向你 SPA 的对应路由，例如：
   - 监测首页：`https://olivr-hzk.github.io/monitor-web/`
   - AI 榜单：`https://olivr-hzk.github.io/monitor-web/rankings/ai`
   - 休闲游戏：`https://olivr-hzk.github.io/monitor-web/rankings/casual/wechat_douyin`（或你实际路径）
3. 这样用户先选 Google Sites 的导航，再在 iframe 里看到对应内容；你站内的侧栏、路由仍然可用。

**注意**：你的 SPA 若用 React Router 的 `BrowserRouter`，且 GitHub Pages 已配置 404 → `index.html`，则上述带 path 的 URL 才能直接打开；否则需用 hash 路由（`/monitor-web/#/rankings/ai`）并在嵌入代码里写带 `#` 的地址。

---

## 方案三：不用 iframe，只用 Google Sites 原生能力“模仿”

不用你的 React 站，只在 Google Sites 里用文字、图片、表格、嵌入 Google 文档/表格等，尽量“模仿”当前看板的信息结构：

- **优点**：不依赖外部托管、全部在 Google 生态内、易编辑。
- **缺点**：没有当前的前端交互（侧栏筛选、多 tab、动态加载 JSON、登录等），只能做到“信息结构类似”的静态页，数据和更新需手动维护（如从你现有 JSON 复制到 Google 表格再嵌入）。

适合：仅需对内展示少量汇总信息、不要求与当前 SPA 一致交互时使用。

---

## 总结

| 方式           | 与当前静态页效果     | 实现难度 |
|----------------|----------------------|----------|
| 方案一 iframe  | 几乎一致（整站嵌入） | 低       |
| 方案二 多页    | 一致，Sites 多一层导航 | 中     |
| 方案三 原生    | 仅信息结构类似       | 中高     |

**建议**：若要“在 Google Sites 上实现类似当前静态页面的效果”，直接采用 **方案一**，在 Google Sites 建一页并嵌入你 GitHub Pages 的地址即可；若希望入口在 Google 且带多页导航，再配合方案二为不同路由建多个子页并分别嵌入。
