# 监测汇总平台

一个现代化的监测汇总平台，支持 AI 热点检测、热点趋势检测、竞品社媒监控和游戏监控。基于 React + TypeScript + Vite + Tailwind CSS 构建。

## 功能特性

- 📱 响应式设计，适配各种屏幕尺寸
- 🎨 现代化的 UI 设计
- 📊 **4 种监测类型**：
  - 🤖 AI 热点检测
  - 📈 热点趋势检测
  - 📱 竞品社媒监控
  - 🎮 游戏监控
- 🔍 多维度筛选和排序功能
- 📚 监测源管理侧边栏
- 🔎 搜索功能（UI已实现）
- 📊 趋势分析和情感分析展示
- 🌓 深色模式切换（UI已实现）

## 技术栈

- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 预览生产构建

```bash
npm run preview
```

## 项目结构

```
src/
├── components/          # React 组件
│   ├── Header.tsx       # 顶部导航栏
│   ├── MonitorCard.tsx  # 监测数据卡片组件
│   ├── MonitorList.tsx  # 监测列表组件
│   └── Sidebar.tsx     # 右侧监测源边栏
├── data/               # 数据文件
│   ├── mockData.ts     # Mock 数据
│   └── dataLoader.ts   # 数据加载器（CSV/DB）
├── types/              # TypeScript 类型定义
│   └── index.ts
├── App.tsx             # 主应用组件
└── main.tsx            # 应用入口
```

## 监测类型说明

### 1. AI 热点检测
监测 AI 领域的最新热点和动态，包括：
- 新模型发布
- 技术突破
- 行业动态
- 产品更新

### 2. 热点趋势检测
分析全网话题趋势，包括：
- 话题热度变化
- 趋势方向（上升/下降/稳定）
- 讨论量统计
- 趋势预测

### 3. 竞品社媒监控
监控竞品在社交媒体上的动态，包括：
- 产品发布
- 融资消息
- 用户反馈
- 营销活动

### 4. 游戏监控
监测游戏行业相关动态，包括：
- 游戏上线
- 版本更新
- 行业报告
- 玩家讨论

## 数据集成

当前项目使用 Mock 数据。要集成真实数据源，请参考 `src/data/dataLoader.ts` 中的示例代码。

### 从 CSV 文件读取数据

```typescript
import { parseCSV } from './data/dataLoader';
const items = await parseCSV('path/to/monitors.csv');
```

### 从数据库读取数据

```typescript
import { loadFromDatabase, loadSourcesFromDatabase } from './data/dataLoader';
const items = await loadFromDatabase();
const sources = await loadSourcesFromDatabase();
```

## CSV 数据格式

监测数据的 CSV 格式示例：

```csv
id,type,title,source,platform,date,time,views,engagement,description,tags,language,trend,sentiment
1,ai热点检测,标题,来源,平台,01-28,14:30,12500,892,描述,"AI,GPT-5",中文,up,positive
```

字段说明：
- `id`: 唯一标识符
- `type`: 监测类型（ai热点检测/热点趋势检测/竞品社媒监控/游戏监控）
- `title`: 标题
- `source`: 来源
- `platform`: 平台（微博/Twitter/Reddit等）
- `date`: 日期（MM-DD格式）
- `time`: 时间（HH:MM格式）
- `views`: 浏览量
- `engagement`: 互动数
- `description`: 描述
- `tags`: 标签（用分号分隔）
- `language`: 语言
- `trend`: 趋势（up/down/stable）
- `sentiment`: 情感（positive/negative/neutral）

## 开发说明

### 添加新的监测数据

编辑 `src/data/mockData.ts` 文件，在 `mockMonitorItems` 数组中添加新的监测对象。

### 自定义样式

项目使用 Tailwind CSS，可以直接在组件中使用 Tailwind 类名，或编辑 `tailwind.config.js` 来自定义主题。

## 后续开发建议

1. **数据集成**：实现从 CSV 或数据库读取真实数据
2. **路由**：添加 React Router 实现多页面导航
3. **状态管理**：考虑使用 Zustand 或 Redux 管理全局状态
4. **API 集成**：添加后端 API 接口调用
5. **用户认证**：实现登录/注册功能
6. **实时更新**：添加 WebSocket 支持实时数据更新
7. **数据可视化**：添加图表展示趋势分析
8. **导出功能**：支持导出监测报告
9. **通知系统**：重要监测事件的通知提醒
10. **深色模式**：完善深色模式切换功能

## 许可证

MIT
