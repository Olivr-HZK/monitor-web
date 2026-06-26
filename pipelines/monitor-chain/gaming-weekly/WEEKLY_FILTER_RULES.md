# 周报筛选规则与优先级说明

更新日期：2026-04-20

本文档总结当前 `send_gaming_weekly.py` 周报链路中，已经生效的筛选规则、排序逻辑、优先级策略与输出约束。

## 1. 适用范围

- 适用于当前周报生成与推送脚本：`send_gaming_weekly.py`
- 适用于中文周报生成、英文翻译，以及飞书 / 企业微信推送前的内容准备
- 不直接覆盖 `TrendRadar` 日报主流程；日报仍有独立配置与关键词体系

## 2. 数据输入范围

- 数据源目录：`output/rss/`
- 时间范围：只读取最近 7 个 RSS SQLite 数据库文件
- 单库读取方式：读取 `rss_items` 表中的 `title / url / feed_id / published_at / summary`
- 初始顺序：每个数据库内部按 `published_at DESC` 读取，再合并到总候选池

## 3. 第一层硬筛：是否属于游戏相关

候选文章要先满足以下至少一项：

- 命中游戏关键词
- 命中游戏公司名单

如果两者都不命中，则直接丢弃。

### 3.1 当前完整游戏关键词列表

当前脚本里用于 `has_game_keyword` 的完整词表如下：

- `游戏`
- `game`
- `gaming`
- `puzzle`
- `match-3`
- `match-`
- `merge`
- `casual`
- `mobile game`
- `手游`
- `gdc`
- `chinajoy`
- `gamescom`
- `gameplay`
- `player`
- `玩家`
- `玩法`
- `关卡`
- `level`
- `rpg`
- `mmorpg`
- `fps`
- `moba`
- `battle royale`
- `indie game`
- `独立游戏`
- `电竞`
- `esports`
- `steam`
- `playstation`
- `xbox`
- `nintendo`
- `switch`
- `app store`
- `google play`
- `游戏引擎`
- `game engine`
- `游戏开发`
- `game dev`
- `游戏设计`
- `game design`
- `游戏发行`
- `game publisher`
- `游戏工作室`
- `game studio`
- `dlc`
- `season pass`
- `loot box`
- `gacha`
- `抽卡`
- `f2p`
- `free-to-play`
- `付费`
- `内购`
- `iap`
- `dau`
- `mau`
- `arpu`
- `ltv`
- `retention`
- `留存`

### 3.2 当前完整游戏公司名单

当前脚本里用于 `has_game_company` 的完整公司词表如下：

- `ncsoft`
- `justplay`
- `capcom`
- `konami`
- `sega`
- `bandai`
- `namco`
- `king`
- `playrix`
- `zynga`
- `supercell`
- `rovio`
- `glu`
- `jam city`
- `scopely`
- `playtika`
- `huuuge`
- `product madness`
- `tencent`
- `netease`
- `mihoyo`
- `lilith`
- `funplus`
- `腾讯`
- `网易`
- `米哈游`
- `莉莉丝`
- `三七`
- `完美`
- `巨人`
- `unity`
- `unreal`
- `epic games`
- `roblox`
- `nintendo`
- `sony`
- `playstation`
- `microsoft`
- `xbox`
- `activision`
- `blizzard`
- `ea`
- `electronic arts`
- `ubisoft`
- `take-two`
- `rockstar`
- `valve`
- `steam`

## 4. 第二层硬筛：明确排除的低价值内容

以下内容会在进入模型前被直接排除。

### 4.1 非游戏行业内容

当前脚本里用于 `is_excluded` 的完整排除词如下：

- `东方雨虹`
- `万事达`
- `bvnk`
- `五金`
- `建材`
- `房地产`
- `证券`
- `基金`
- `理财`
- `保险`
- `银行`
- `汽车`
- `新能源`
- `电动车`
- `充电桩`
- `qclaw`
- `法律工具`
- `legal tool`
- `法务`
- `招聘`
- `hiring`
- `job opening`
- `career`
- `股票`
- `stock`
- `ipo`
- `上市公司`

### 4.2 职场 / 组织分析类内容

如果标题、摘要、URL 中出现以下信号，会被视为低优先级并直接过滤。

当前完整 `WORKPLACE_EXCLUSION_KEYWORDS` 如下：

- `layoff`
- `layoffs`
- `workplace culture`
- `work culture`
- `job security`
- `brain drain`
- `hiring`
- `career`
- `recruitment`
- `redundancy`
- `staff morale`
- `headcount`
- `hr strategy`
- `people strategy`
- `toxic culture`
- `burnout`
- `union`
- `职场`
- `裁员`
- `工作文化`
- `企业文化`
- `组织文化`
- `招聘`
- `求职`
- `岗位`
- `脑流失`

额外规则：

- 如果 URL 中带 `/opinion`，并且同时命中这类词，会优先判定为职场/观点型文章并排除
- 如果标题中直接出现强信号词，也会直接排除

### 4.3 低信噪比播客串讲页

以下类型页面会直接排除。

当前完整 `LOW_SIGNAL_ROUNDUP_KEYWORDS` 如下：

- `on the podcast:`
- `podcast:`
- `subscribe to the mobilegamer.biz podcast`

额外 URL 规则：

- URL 中含 `podcast`
- 且同时带 `subscribe` 或 `podcast-now`

原因：

- 这类页面通常是多主题串讲，不适合作为单条行业洞察的依据

### 4.4 泛汇总 / digest / roundup 页面

如果页面属于以下类型，则会进一步检查它是否带有明确的 Puzzle 信号。

当前完整 `GENERIC_DIGEST_KEYWORDS` 如下：

- `data digest:`
- `plenty more`
- `round-up`
- `roundup`
- `week in views`

只有当标题 / 摘要 / URL 本身包含以下强相关信号时，才允许保留。

当前完整 `PUZZLE_SPECIFIC_SIGNALS` 如下：

- `puzzle`
- `match-3`
- `merge`
- `word game`
- `hidden object`
- `solitaire`
- `casual game`
- `candy crush`
- `royal match`
- `gardenscapes`
- `homescapes`
- `fishdom`
- `project makeover`
- `merge mansion`
- `wordscapes`
- `nyt games`
- `sort`
- `mahjong`
- `jigsaw`

否则直接排除。

原因：

- 这类页面常见问题是“信息面很宽，但对 Puzzle 团队不够具体”

## 5. 第三层硬筛：按链接去重

在通过前两层过滤后，脚本会按 URL 去重：

- 同一链接只保留 1 条
- 去重发生在进入均衡排序之前

这一步主要解决：

- 同一篇文章跨天重复入库
- 同一页面在多个数据库中反复出现

## 6. 输入排序与优先级分发逻辑

当前不是简单按时间取前 50 条，而是分两段处理。

### 6.1 三主信源均衡

主信源定义：

- `mobilegamer`
- `gamesindustry`
- `pocketgamer-biz`

策略：

- 先把三主信源分别按时间倒序排序
- 在前 50 条中按轮询方式等权混排
- 目标是避免某一来源刷屏，保证模型看到更均衡的输入结构

### 6.2 非主信源补充

在前 50 条均衡段之后：

- 先拼接三主信源各自剩余内容
- 再拼接其他信源内容
- 剩余部分仍按时间倒序

### 6.3 传给模型的候选上限

- 仅把前 `BALANCED_HEAD_LIMIT = 50` 条候选送入模型
- 不是用全部候选池做模型分析

## 7. 结构化优先级增强

除硬筛外，当前还会对某些文章补充“战略线索”。

目前已实现的特例：

- 对 `How China came to dominate mobile games...` 这篇文章，额外附加一条结构化提示
- 提示内容聚焦于：
  - 把 TikTok 上验证过的 meme 快速做进具体关卡
  - 次日上线同类内容
  - 热点素材、关卡生产、LiveOps 节奏之间的联动效率

目的：

- 引导模型提炼“可执行打法”
- 避免只输出“中国厂商效率更高”这种宽泛结论

## 8. AI 主题优先级规则

当前额外增加了一层 AI 主题优先级，用于把这类文章前置到候选池更靠前的位置，并在 prompt 中要求优先进入 Top 结论。

### 8.1 高优先级

方向：

- 休闲游戏公司使用 AI 工具
- 无论该 AI 用于：
  - 新产品开发
  - 关卡 / 内容生产
  - 素材生产
  - 原型验证
  - 提效 / 自动化

当前高优先级命中条件：

- 命中 `CASUAL_GAME_COMPANIES`
- 且命中 `AI_TOOL_KEYWORDS`

命中后策略：

- 进入高优先级桶
- 在排序时优先于普通新闻
- prompt 中要求：如果出现，必须优先进入 `Top 3`

### 8.2 次高优先级 A

方向：

- 头部游戏公司使用 AI 工具
- 不限游戏类型，不要求一定是休闲游戏公司

当前次高优先级 A 命中条件：

- 命中 `TOP_GAME_COMPANIES`
- 且命中 `AI_TOOL_KEYWORDS`

### 8.3 次高优先级 B

方向：

- AI 工具应用于游戏开发

当前次高优先级 B 命中条件：

- 命中 `AI_TOOL_KEYWORDS`
- 且命中 `GAME_DEV_AI_APPLICATION_KEYWORDS`

### 8.4 当前完整高优先级休闲游戏公司词表

- `king`
- `playrix`
- `scopely`
- `zynga`
- `supercell`
- `rovio`
- `jam city`
- `playtika`
- `huuuge`
- `product madness`
- `dream games`
- `moon active`
- `tripledot`
- `metacore`
- `superplay`
- `candivore`
- `saygames`
- `voodoo`
- `homa`
- `tactile`
- `rollic`
- `peak`

### 8.5 当前完整头部游戏公司词表

- `tencent`
- `netease`
- `mihoyo`
- `lilith`
- `funplus`
- `king`
- `playrix`
- `scopely`
- `supercell`
- `zynga`
- `rovio`
- `nintendo`
- `sony`
- `playstation`
- `microsoft`
- `xbox`
- `activision`
- `blizzard`
- `ea`
- `electronic arts`
- `ubisoft`
- `take-two`
- `rockstar`
- `valve`
- `steam`
- `epic games`
- `roblox`
- `capcom`
- `konami`
- `bandai`
- `namco`
- `sega`

### 8.6 当前完整 AI 工具关键词

- `ai`
- `aigc`
- `generative ai`
- `genai`
- `agentic ai`
- `llm`
- `ai tool`
- `ai tools`
- `ai assistant`
- `copilot`
- `automation`
- `workflow`
- `productivity`
- `efficiency`
- `tooling`
- `pipeline`
- `prompt`
- `model`
- `assistant`
- `智能工具`
- `ai工具`
- `生成式ai`
- `大模型`
- `智能助手`
- `自动化`
- `提效`
- `效率`

### 8.7 当前完整“AI 用于游戏开发”关键词

- `game development`
- `game dev`
- `level generation`
- `level design`
- `content pipeline`
- `asset generation`
- `creative pipeline`
- `prototype`
- `prototyping`
- `testing`
- `qa`
- `liveops`
- `live ops`
- `game design`
- `content production`
- `content iteration`
- `meme in their level`
- `关卡生成`
- `关卡设计`
- `游戏开发`
- `开发提效`
- `内容生产`
- `素材生产`
- `原型验证`
- `测试自动化`
- `活动内容`
- `关卡生产`
- `工作流`
- `游戏设计`

## 9. 模型软筛优先级

在硬筛之后，模型还会根据 prompt 继续做“软筛”。

### 8.1 模型优先选择的内容

- 与 Puzzle Game 直接相关的新闻
- 与 Match-3 / Merge / Word / Hidden Object / Solitaire / Casual 直接相关的产品与玩法
- 有明确产品名、玩法名、指标或策略动作的内容
- 能指导买量、留存、LTV、关卡设计、素材策略、活动节奏的内容
- 有具体游戏、具体玩法、具体产品数据、具体策略动作的内容
- 可执行的内容生产 / 素材 / 关卡 / LiveOps 方法论

### 8.2 模型明确回避的内容

- 泛行业评论
- 泛观点型文章
- 播客串讲页
- 职场观察 / 企业文化复盘
- 单纯“榜单/数据汇总”的文章，除非能落到具体 Puzzle 产品与具体指标
- 不能落到具体游戏 / 具体玩法 / 具体动作的空泛行业观察

## 10. 生成结果的输出去重约束

模型生成后，脚本还会再做一次结果层面的硬约束。

### 9.1 全文去重规则

- 同一页面全文最多出现 2 次

### 9.2 单板块去重规则

- 同一页面在同一个板块里最多出现 1 次

### 9.3 Top 3 重新编号

如果由于去重导致 `Top 3` 中条目被删除：

- 会自动把剩余编号重新整理成 `1. 2. 3.`

目的：

- 防止一篇文章横跨多个板块反复出现
- 保证周报结构清晰

## 11. 当前实际优先级顺序

可以把当前逻辑概括为下面这个顺序：

1. 最近 7 天 RSS 入库文章
2. 命中游戏关键词或游戏公司名单
3. 排除非游戏行业内容
4. 排除职场 / 裁员 / 企业文化 / 招聘类内容
5. 排除播客串讲页
6. 排除不够具体的 digest / roundup / views 页面
7. 按 URL 去重
8. 先给 AI 主题文章打优先级分数
9. 高优先级：休闲游戏公司使用 AI 工具
10. 次高优先级：头部游戏公司使用 AI 工具
11. 次高优先级：AI 工具应用于游戏开发
12. 在此基础上做主三信源均衡排序
13. 只取前 50 条给模型
14. 对个别重要文章补充结构化战略提示
15. 模型根据 Puzzle 优先级与“具体性”继续软筛
16. 输出后再做引用去重与板块去重

## 12. 当前策略的核心倾向

当前这套规则的目标不是“覆盖尽可能多的游戏新闻”，而是：

- 尽量压制泛行业、泛职场、泛播客、泛汇总内容
- 尽量提高 Puzzle 相关、玩法相关、策略相关、可执行内容的占比
- 让周报更偏向：
  - 具体产品
  - 具体玩法
  - 具体买量素材
  - 具体内容生产方法
  - 具体 LiveOps / 关卡 / 变现启发

## 13. 已知局限

当前逻辑仍有一些天然局限：

- 关键词筛选仍然依赖标题与摘要质量，不能保证完全理解原文
- 某些“观点型文章”如果标题较好、同时带具体策略，仍可能保留
- digest 页虽然被压制，但如果标题自带强 Puzzle 信号，仍可能进入候选
- 结构化战略提示目前只对个别文章做了定制，不是通用抽取系统

## 14. 后续可继续优化的方向

- 增加“具体游戏 / 具体玩法 / 具体动作”打分器，用分数代替纯关键词过滤
- 对 digest / roundup 类页面做二次摘要抽取，只有抽到具体 Puzzle 条目才放行
- 增加更多结构化 hint 模板，把高价值文章的“可执行线索”稳定注入模型
- 为最终 JSON 快照写入：
  - 命中过的过滤规则
  - 被保留的优先级理由
  - 实际使用的 LLM 路径

## 15. 文档维护约定

后续如果你希望通过修改文档来传达改进方向，建议直接改这几部分：

- 第 3 节：游戏关键词与公司名单
- 第 4 节：排除词、低信噪比页面规则、digest 放行条件
- 第 8 节：模型软筛优先级
- 第 10 节：整体优先级顺序

约定如下：

- 文档中的词表应视为“期望规则”
- 如果文档与代码不一致，以你最新修改后的文档意图为准
- 我后续收到你的调整请求时，会优先对照这份文档补齐代码
- 如果某条规则只在文档中出现、尚未落代码，我会明确告诉你“已记录但未实现”或直接帮你实现
