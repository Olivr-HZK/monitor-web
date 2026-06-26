# 🎮 Puzzle Game 出海市场周报系统

专为出海 Puzzle Game 厂商打造的游戏行业资讯周报系统，每周一自动推送精选游戏行业资讯到飞书。

## 📋 功能特点

- ✅ **自动采集**：从多个游戏媒体源采集最新资讯
- ✅ **智能筛选**：AI 自动过滤非游戏内容，聚焦 Puzzle Game 赛道
- ✅ **AI 分析**：使用 OpenRouter qwen/qwen3.7-max 生成专业周报
- ✅ **美观推送**：飞书卡片形式推送，支持点击查看原文
- ✅ **成本可控**：按 OpenRouter 后台实际用量计费

## 🎯 周报内容

### Top 3 大事
- 本周最重要的 3 条新闻
- 综合评分：重大交易（40%）+ Puzzle Game 相关性（30%）+ 行业趋势（20%）+ 实用价值（10%）

### 详细板块
1. **竞品与头部动态**：大厂动态、产品发布、收购并购
2. **玩法与机制创新**：新玩法、新机制、创新案例
3. **买量风向与素材**：广告投放、素材趋势、UA 策略
4. **新兴市场机会**：新市场、新渠道、新机会
5. **分析师洞察**：实操建议、趋势分析

## 📦 安装步骤

### 1. 环境要求
- Python 3.8+
- 已安装 TrendRadar（用于采集数据）

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

### 3. 配置环境变量
需要配置以下信息：

#### 飞书 Webhook
在 `send_gaming_weekly.py` 中修改：
```python
FEISHU_WEBHOOK = "你的飞书webhook地址"
```

#### OpenRouter API Key
在 `send_gaming_weekly.py` 中修改：
```python
AI_API_KEY = "你的 OpenRouter API Key"
```

#### TrendRadar 数据库路径
在 `send_gaming_weekly.py` 中修改：
```python
RSS_DB_DIR = "/path/to/TrendRadar/output/rss"
```

## 🚀 使用方法

### 手动运行
```bash
python3 send_gaming_weekly.py
```

### 定时运行（每周一 06:00 生成，08:00 推送）
统一通过 monitor-web 的 cron 入口设置定时任务：

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每周一 06:00 生成，08:00 推送）
0 6 * * 1 /Users/ggbond/lyb/monitor-web/scripts/cron/run_job.sh gaming_weekly_generate
0 8 * * 1 /Users/ggbond/lyb/monitor-web/scripts/cron/run_job.sh gaming_weekly_push
```

## 📊 成本说明

### AI 调用成本
- **模型**：OpenRouter qwen/qwen3.7-max
- **定价**：
  - 以 OpenRouter 后台实际账单为准
- **实际成本**：
  - 按 OpenRouter 后台的实际 token 用量和模型费率计算

### Token 使用量
- 输入 tokens：约 5,000-6,000（新闻标题+摘要）
- 输出 tokens：约 800-1,200（周报内容）
- 总计：约 6,000-7,000 tokens

## 🔧 配置说明

### 游戏公司列表
在 `send_gaming_weekly.py` 中的 `GAME_COMPANIES` 列表可以添加更多游戏公司：

```python
GAME_COMPANIES = [
    "ncsoft", "justplay", "capcom", "konami", "sega",
    "king", "playrix", "zynga", "supercell", "rovio",
    # 添加更多公司...
]
```

### 筛选关键词
代码会自动筛选包含以下关键词的新闻：
- 游戏类型：game, gaming, puzzle, match-3, merge, casual
- 游戏术语：gameplay, player, 玩家, 玩法
- 数据指标：dau, mau, arpu, ltv, retention
- 游戏平台：steam, playstation, xbox, nintendo

### 排除关键词
自动排除以下内容：
- 非游戏业务：法律工具、招聘、股票IPO
- 非游戏公司：建材、房地产、金融等

## 📁 文件说明

```
gaming-daily-report/
├── send_gaming_weekly.py      # 主程序（周报生成和推送）
├── requirements.txt            # Python 依赖
├── README_WEEKLY.md           # 本文档
└── config/                     # TrendRadar 配置文件（可选）
    ├── config_gaming.yaml
    └── frequency_words_gaming_strict.txt
```

## 🔍 数据来源

### RSS 源（英文游戏媒体）
- Game Developer (Gamasutra)
- Mobile Gamer
- GamesIndustry.biz
- Polygon
- IGN
- GameSpot
- Unity Blog

### 数据采集
使用 TrendRadar 每天自动采集上述媒体的 RSS 订阅，存储到 SQLite 数据库。

## ⚠️ 注意事项

1. **TrendRadar 必须定期运行**
   - 周报依赖 TrendRadar 采集的数据
   - 建议每天运行一次 TrendRadar
   - 可以使用 crontab 设置定时任务

2. **数据库路径**
   - 确保 `RSS_DB_DIR` 路径正确
   - TrendRadar 会在 `output/rss/` 目录下生成日期命名的数据库文件

3. **API Key 安全**
   - 不要将 API Key 提交到代码仓库
   - 建议使用环境变量或配置文件管理

4. **飞书 Webhook**
   - 确保 Webhook 地址有效
   - 测试推送是否正常

## 🐛 常见问题

### Q: 为什么没有收到飞书消息？
A: 检查以下几点：
1. Webhook 地址是否正确
2. 网络是否正常
3. 查看运行日志中的错误信息

### Q: 为什么周报内容很少？
A: 可能的原因：
1. TrendRadar 数据库中游戏相关新闻较少
2. 筛选条件太严格
3. 可以调整 `GAME_COMPANIES` 列表和关键词

### Q: 如何修改 Top 3 的选择标准？
A: 在 `send_gaming_weekly.py` 中修改提示词中的权重：
```python
1. **重大交易事件**（权重40%）
2. **Puzzle Game相关性**（权重30%）
3. **行业政策和市场趋势**（权重20%）
4. **实用价值**（权重10%）
```

### Q: 如何避免 Top 3 和后面板块重复？
A: 代码已经在提示词中明确要求 AI 去重，如果仍有重复，可以：
1. 增加提示词中的去重强调
2. 在代码层面做后处理去重

## 📞 技术支持

如有问题，请检查：
1. Python 版本是否 >= 3.8
2. 依赖是否正确安装
3. 配置是否正确
4. TrendRadar 是否正常运行

## 📝 更新日志

### v1.0.0 (2026-03-24)
- ✅ 初始版本
- ✅ 支持周报生成和飞书推送
- ✅ AI 智能分析和内容筛选
- ✅ 美观的飞书卡片展示
- ✅ 公司名和数据指标自动加粗
- ✅ Top 3 智能选择和去重
