"""
数据库模块
用于保存和管理游戏数据（按游戏存储，每个游戏一条记录）
"""
import sqlite3
import os
import json
from typing import Dict, List, Optional
from datetime import datetime
import config


class VideoDatabase:
    """游戏数据库管理器（按游戏存储）"""

    def __init__(self, db_path: str = None):
        """
        初始化数据库

        Args:
            db_path: 数据库文件路径，默认使用 data/wechatdouyin.db
        """
        if db_path is None:
            db_dir = os.path.dirname(config.RANKINGS_CSV_PATH)
            db_path = os.path.join(db_dir, "wechatdouyin.db")

        self.db_path = db_path
        # 确保目录存在
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        # 初始化数据库
        self._init_database()
        # 执行数据迁移（如果是从旧版本升级）
        self._migrate_from_video_based()

    def _init_database(self):
        """初始化数据库表结构"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 检查是否存在旧的videos表（按视频存储）
        cursor.execute('''
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='videos'
        ''')
        old_table_exists = cursor.fetchone() is not None

        # 创建新的games表（按游戏存储）
        # 列顺序：重要字段在前（游戏名、排名、公司、玩法信息），辅助信息在后
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_name TEXT UNIQUE NOT NULL,
                rank_wx TEXT,       -- 微信小游戏排名
                rank_dy TEXT,       -- 抖音小游戏排名
                rank_ios TEXT,      -- iOS排名（SensorTower）
                rank_android TEXT,  -- Android排名（SensorTower）
                game_company TEXT,
                gameplay_analysis TEXT,  -- 游戏玩法分析结果
                analysis_model TEXT,  -- 使用的分析模型
                analyzed_at TIMESTAMP,  -- 分析时间
                game_rank TEXT,      -- 保留原有字段（兼容性）
                rank_change TEXT,
                platform TEXT,       -- 平台（例如：微信小游戏 / 抖音）
                source TEXT,         -- 来源（例如：引力引擎）
                board_name TEXT,     -- 榜单名称（例如：微信小游戏人气榜）
                monitor_date TEXT,   -- 监控日期（YYYY-MM-DD）
                aweme_id TEXT,
                title TEXT,
                description TEXT,
                video_url TEXT,
                video_urls TEXT,  -- JSON格式存储所有URL
                cover_url TEXT,
                author_uid TEXT,
                duration REAL,
                like_count INTEGER DEFAULT 0,
                comment_count INTEGER DEFAULT 0,
                play_count INTEGER DEFAULT 0,
                create_time INTEGER,
                share_url TEXT,
                original_video_url TEXT,  -- 原视频URL（最高画质，如果API返回）
                gdrive_url TEXT,  -- Google Drive公开访问链接
                gdrive_file_id TEXT,  -- Google Drive文件ID
                local_path TEXT,  -- 本地下载路径
                downloaded INTEGER DEFAULT 0,  -- 是否已下载 0=否 1=是
                search_keyword TEXT,  -- 搜索关键词
                relevance_score INTEGER DEFAULT 0,  -- 相关性评分
                screenshot_image_key TEXT,  -- 飞书截图image_key（JSON格式）
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 数据库迁移：添加新字段（如果不存在）
        migrations = [
            ("game_rank", "TEXT"),
            ("game_company", "TEXT"),
            ("rank_change", "TEXT"),
            ("platform", "TEXT"),
            ("source", "TEXT"),
            ("board_name", "TEXT"),
            ("monitor_date", "TEXT"),
            ("rank_wx", "TEXT"),
            ("rank_dy", "TEXT"),
            ("rank_ios", "TEXT"),
            ("rank_android", "TEXT"),
            ("relevance_score", "INTEGER DEFAULT 0"),
            ("gameplay_analysis", "TEXT"),
            ("analysis_model", "TEXT"),
            ("analyzed_at", "TIMESTAMP"),
            ("original_video_url", "TEXT"),
            ("gdrive_url", "TEXT"),
            ("gdrive_file_id", "TEXT"),
            ("screenshot_image_key", "TEXT")
        ]

        for field_name, field_type in migrations:
            try:
                cursor.execute(f'SELECT {field_name} FROM games LIMIT 1')
            except sqlite3.OperationalError:
                # 字段不存在，需要添加
                print(f"检测到旧版数据库，正在添加{field_name}字段...")
                cursor.execute(f'ALTER TABLE games ADD COLUMN {field_name} {field_type}')

        # 检查是否需要重建表以调整列顺序（如果表已存在但列顺序不对）
        # 必须在添加字段之后执行，确保所有字段都存在
        self._migrate_table_column_order(cursor)

        # weekly_rankings：每周 × 每平台一行，ranking 为完整榜单 JSON。使用 IF NOT EXISTS 避免覆盖已导入数据。
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weekly_rankings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_range TEXT,           -- 例如：2026-1-19~2026-1-25
                week_start TEXT,
                week_end TEXT,
                platform TEXT,             -- 规范化：wx/dy/ios/android
                source TEXT,               -- 引力引擎 / SensorTower 等
                board_name TEXT,           -- 榜单名称
                region TEXT,               -- 地区（如：中国/多地区）
                ranking TEXT,              -- 该周该平台完整榜单的 JSON（由 CSV 转换）
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 创建索引
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_game_name ON games(game_name)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_game_rank ON games(game_rank)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_created_at ON games(created_at)
        ''')

        # weekly_rankings 索引
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_weekly_week_platform
            ON weekly_rankings(week_range, platform)
        ''')

        # 周报玩法趋势表：存放监控日期、平台、来源、本周热点玩法趋势分析
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weekly_report_trends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                monitor_date TEXT NOT NULL,
                week_range TEXT,
                platform TEXT NOT NULL,
                source TEXT NOT NULL,
                trend_analysis TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_weekly_trends_monitor_platform
            ON weekly_report_trends(monitor_date, platform)
        ''')

        # 周报简单表：仅存新进榜与飙升游戏的简单内容（玩法仍存 games.gameplay_analysis）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weekly_report_simple (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_range TEXT NOT NULL,
                platform TEXT NOT NULL,
                game_name TEXT NOT NULL,
                change_type TEXT NOT NULL,
                rank TEXT,
                rank_change TEXT,
                summary TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_weekly_simple_week_platform
            ON weekly_report_simple(week_range, platform)
        ''')

        # top20_ranking：每周 full 榜（CSV 11 列 + 元数据）
        # platform_key：wx / dy；chart_key：popularity / bestseller / casual_play（与目录、爬虫一致）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS top20_ranking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_range TEXT NOT NULL,
                platform_key TEXT NOT NULL,
                chart_key TEXT NOT NULL DEFAULT '',
                rank TEXT,
                game_name TEXT,
                game_type TEXT,
                platform TEXT,
                source TEXT,
                board_name TEXT,
                monitor_date TEXT,
                publish_time TEXT,
                company TEXT,
                rank_change TEXT,
                region TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_top20_week_platform
            ON top20_ranking(week_range, platform_key)
        ''')

        # rank_changes：每周异动榜
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS rank_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_range TEXT NOT NULL,
                platform_key TEXT NOT NULL,
                chart_key TEXT NOT NULL DEFAULT '',
                rank TEXT,
                game_name TEXT,
                game_type TEXT,
                platform TEXT,
                source TEXT,
                board_name TEXT,
                monitor_date TEXT,
                publish_time TEXT,
                company TEXT,
                rank_change TEXT,
                region TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_rank_changes_week_platform
            ON rank_changes(week_range, platform_key)
        ''')

        self._ensure_ranking_chart_key_schema(cursor)

        conn.commit()
        conn.close()

    def _ensure_ranking_chart_key_schema(self, cursor) -> None:
        """
        为 top20_ranking / rank_changes 增加 chart_key，并把旧版复合 platform_key（如 wx_popularity）
        拆成 platform_key=wx、chart_key=popularity。唯一键语义：(week_range, platform_key, chart_key)。
        """
        for table in ("top20_ranking", "rank_changes"):
            cursor.execute(f"PRAGMA table_info({table})")
            col_names = [r[1] for r in cursor.fetchall()]
            if not col_names:
                continue
            if "chart_key" not in col_names:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN chart_key TEXT NOT NULL DEFAULT ''")
            # 拆分 wx_xxx / dy_xxx（含 casual_play）
            cursor.execute(
                f"""
                UPDATE {table} SET chart_key = substr(platform_key, 4)
                WHERE platform_key GLOB 'wx_*' AND LENGTH(platform_key) > 3
                """
            )
            cursor.execute(
                f"""
                UPDATE {table} SET platform_key = 'wx'
                WHERE platform_key GLOB 'wx_*' AND LENGTH(platform_key) > 3
                """
            )
            cursor.execute(
                f"""
                UPDATE {table} SET chart_key = substr(platform_key, 4)
                WHERE platform_key GLOB 'dy_*' AND LENGTH(platform_key) > 3
                """
            )
            cursor.execute(
                f"""
                UPDATE {table} SET platform_key = 'dy'
                WHERE platform_key GLOB 'dy_*' AND LENGTH(platform_key) > 3
                """
            )
        cursor.execute("DROP INDEX IF EXISTS idx_top20_week_platform")
        cursor.execute("DROP INDEX IF EXISTS idx_rank_changes_week_platform")
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_top20_week_platform_chart
            ON top20_ranking(week_range, platform_key, chart_key)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_rank_changes_week_platform_chart
            ON rank_changes(week_range, platform_key, chart_key)
            """
        )
        # 抖音第三榜与微信畅玩榜区分：dy + casual_play（旧）→ new_games（新游榜）
        for table in ("top20_ranking", "rank_changes"):
            cursor.execute(
                f"""
                UPDATE {table} SET chart_key = 'new_games'
                WHERE platform_key = 'dy' AND chart_key = 'casual_play'
                """
            )
        # chart_key 为空：旧版仅按 wx/dy 入库，统一归为 popularity（微信=人气榜、抖音=热门榜，展示名见 board_name）
        for table in ("top20_ranking", "rank_changes"):
            cursor.execute(
                f"""
                UPDATE {table} SET chart_key = 'popularity'
                WHERE platform_key IN ('wx', 'dy')
                  AND (chart_key IS NULL OR TRIM(chart_key) = '')
                """
            )

    def _migrate_table_column_order(self, cursor):
        """
        迁移表结构以调整列顺序（将重要字段放在前面）
        如果表已存在但列顺序不对，重建表
        """
        try:
            # 检查表是否存在
            cursor.execute('''
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='games'
            ''')
            if not cursor.fetchone():
                return  # 表不存在，不需要迁移

            # 获取当前表的列信息
            cursor.execute('PRAGMA table_info(games)')
            current_columns = [row[1] for row in cursor.fetchall()]

            # 期望的新列顺序（重要字段在前）
            expected_order = [
                'id', 'game_name', 'rank_wx', 'rank_dy', 'rank_ios', 'rank_android',
                'game_company', 'gameplay_analysis', 'analysis_model', 'analyzed_at',
                'game_rank', 'rank_change', 'platform', 'source', 'board_name', 'monitor_date',
                'aweme_id', 'title', 'description', 'video_url', 'video_urls', 'cover_url',
                'author_uid', 'duration', 'like_count', 'comment_count', 'play_count',
                'create_time', 'share_url', 'original_video_url', 'gdrive_url', 'gdrive_file_id',
                'local_path', 'downloaded', 'search_keyword', 'relevance_score',
                'screenshot_image_key', 'created_at', 'updated_at'
            ]

            # 检查列顺序是否匹配（只检查前几个重要字段）
            if len(current_columns) > 2:
                # 检查前几个字段的顺序
                if current_columns[1] == 'game_name' and len(current_columns) > 5:
                    # 检查排名字段是否在正确位置
                    if current_columns[2:6] == ['rank_wx', 'rank_dy', 'rank_ios', 'rank_android']:
                        # 列顺序已经正确，不需要迁移
                        return

            # 需要重建表
            print("检测到表列顺序需要调整，开始重建表...")

            # 获取所有现有数据
            cursor.execute('SELECT * FROM games')
            rows = cursor.fetchall()

            # 获取列名
            cursor.execute('PRAGMA table_info(games)')
            old_columns = [row[1] for row in cursor.fetchall()]

            # 创建新表（按新顺序）
            cursor.execute('DROP TABLE games')
            cursor.execute('''
                CREATE TABLE games (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_name TEXT UNIQUE NOT NULL,
                    rank_wx TEXT,
                    rank_dy TEXT,
                    rank_ios TEXT,
                    rank_android TEXT,
                    game_company TEXT,
                    gameplay_analysis TEXT,
                    analysis_model TEXT,
                    analyzed_at TIMESTAMP,
                    game_rank TEXT,
                    rank_change TEXT,
                    platform TEXT,
                    source TEXT,
                    board_name TEXT,
                    monitor_date TEXT,
                    aweme_id TEXT,
                    title TEXT,
                    description TEXT,
                    video_url TEXT,
                    video_urls TEXT,
                    cover_url TEXT,
                    author_uid TEXT,
                    duration REAL,
                    like_count INTEGER DEFAULT 0,
                    comment_count INTEGER DEFAULT 0,
                    play_count INTEGER DEFAULT 0,
                    create_time INTEGER,
                    share_url TEXT,
                    original_video_url TEXT,
                    gdrive_url TEXT,
                    gdrive_file_id TEXT,
                    local_path TEXT,
                    downloaded INTEGER DEFAULT 0,
                    search_keyword TEXT,
                    relevance_score INTEGER DEFAULT 0,
                    screenshot_image_key TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # 重建索引
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_game_name ON games(game_name)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_game_rank ON games(game_rank)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_created_at ON games(created_at)')

            # 迁移数据（只迁移两个表都有的列）
            if rows:
                new_columns = ['id', 'game_name', 'rank_wx', 'rank_dy', 'rank_ios', 'rank_android',
                             'game_company', 'gameplay_analysis', 'analysis_model', 'analyzed_at',
                             'game_rank', 'rank_change', 'platform', 'source', 'board_name', 'monitor_date',
                             'aweme_id', 'title', 'description', 'video_url', 'video_urls', 'cover_url',
                             'author_uid', 'duration', 'like_count', 'comment_count', 'play_count',
                             'create_time', 'share_url', 'original_video_url', 'gdrive_url', 'gdrive_file_id',
                             'local_path', 'downloaded', 'search_keyword', 'relevance_score',
                             'screenshot_image_key', 'created_at', 'updated_at']

                # 创建列名映射（旧列名 -> 新列名）
                column_map = {old_col: old_col for old_col in old_columns if old_col in new_columns}

                # 构建INSERT语句
                common_columns = [col for col in new_columns if col in column_map]
                placeholders = ','.join(['?' for _ in common_columns])

                # 迁移数据
                for row in rows:
                    row_dict = dict(zip(old_columns, row))
                    values = [row_dict.get(col) for col in common_columns]
                    cursor.execute(f'''
                        INSERT INTO games ({','.join(common_columns)})
                        VALUES ({placeholders})
                    ''', values)

                print(f"✓ 表重建完成，已迁移 {len(rows)} 条记录")

        except Exception as e:
            print(f"⚠ 迁移表列顺序时出错：{e}")
            import traceback
            traceback.print_exc()
            # 出错时回滚，保持原表不变
            pass

    def _migrate_from_video_based(self):
        """从按视频存储的旧表迁移到按游戏存储的新表"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 检查是否存在旧的videos表
        cursor.execute('''
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='videos'
        ''')
        old_table_exists = cursor.fetchone() is not None

        if not old_table_exists:
            conn.close()
            return

        # 检查games表是否已有数据
        cursor.execute('SELECT COUNT(*) FROM games')
        games_count = cursor.fetchone()[0]

        if games_count > 0:
            # 已经迁移过了，不需要再次迁移
            conn.close()
            return

        print("[*] 检测到旧版数据库（按视频存储），开始迁移到新版（按游戏存储）...")

        # 从旧表读取所有数据，按游戏分组
        cursor.execute('SELECT * FROM videos ORDER BY downloaded DESC, created_at DESC')
        old_rows = cursor.fetchall()

        # 获取列名
        cursor.execute('PRAGMA table_info(videos)')
        old_columns = [col[1] for col in cursor.fetchall()]

        # 按游戏分组，每个游戏只保留已下载的那个视频（如果都没有下载，保留最新的）
        games_dict = {}
        for row in old_rows:
            row_dict = dict(zip(old_columns, row))
            game_name = row_dict.get("game_name")

            if not game_name:
                continue

            # 如果该游戏还没有记录，或者当前记录已下载而之前的未下载，则更新
            if game_name not in games_dict:
                games_dict[game_name] = row_dict
            else:
                # 优先保留已下载的视频
                if row_dict.get("downloaded") == 1 and games_dict[game_name].get("downloaded") != 1:
                    games_dict[game_name] = row_dict

        # 将数据插入到新表
        migrated_count = 0
        for game_name, game_data in games_dict.items():
            try:
                video_urls = game_data.get("video_urls", [])
                video_urls_json = json.dumps(video_urls, ensure_ascii=False) if video_urls else None

                screenshot_key = game_data.get("screenshot_image_key")
                if screenshot_key and isinstance(screenshot_key, list):
                    screenshot_key = json.dumps(screenshot_key, ensure_ascii=False)

                cursor.execute('''
                    INSERT INTO games (
                        game_name, aweme_id, title, description,
                        video_url, video_urls, cover_url,
                        author_uid, duration,
                        like_count, comment_count, play_count,
                        create_time, share_url, original_video_url, gdrive_url, gdrive_file_id,
                        local_path, downloaded, search_keyword, relevance_score,
                        gameplay_analysis, analysis_model, analyzed_at, screenshot_image_key
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    game_name,
                    game_data.get("aweme_id"),
                    game_data.get("title"),
                    game_data.get("description"),
                    game_data.get("video_url"),
                    video_urls_json,
                    game_data.get("cover_url"),
                    game_data.get("author_uid"),
                    game_data.get("duration"),
                    game_data.get("like_count", 0),
                    game_data.get("comment_count", 0),
                    game_data.get("play_count", 0),
                    game_data.get("create_time"),
                    game_data.get("share_url"),
                    game_data.get("original_video_url"),
                    game_data.get("gdrive_url"),
                    game_data.get("gdrive_file_id"),
                    game_data.get("local_path"),
                    game_data.get("downloaded", 0),
                    game_data.get("search_keyword"),
                    game_data.get("relevance_score", 0),
                    game_data.get("gameplay_analysis"),
                    game_data.get("analysis_model"),
                    game_data.get("analyzed_at"),
                    screenshot_key
                ))
                migrated_count += 1
            except sqlite3.IntegrityError:
                # 游戏已存在，跳过
                continue
            except Exception as e:
                print(f"迁移游戏 '{game_name}' 时出错：{str(e)}")
                continue

        conn.commit()
        conn.close()

        if migrated_count > 0:
            print(f"✅ 成功迁移 {migrated_count} 个游戏的数据到新表")
            print("   旧表 'videos' 已保留，如需删除请手动执行：DROP TABLE videos")

    def save_game(self, game_info: Dict) -> bool:
        """
        保存游戏信息到数据库（按游戏名称，每个游戏一条记录）

        Args:
            game_info: 游戏信息字典，必须包含game_name

        Returns:
            是否保存成功
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            game_name = game_info.get("game_name")
            if not game_name:
                print("错误：game_name是必需的")
                conn.close()
                return False

            # 将video_urls列表转为JSON字符串
            video_urls = game_info.get("video_urls", [])
            video_urls_json = json.dumps(video_urls, ensure_ascii=False) if video_urls else None

            screenshot_key = game_info.get("screenshot_image_key")
            if screenshot_key and isinstance(screenshot_key, list):
                screenshot_key = json.dumps(screenshot_key, ensure_ascii=False)

            # 检查是否已存在
            cursor.execute('SELECT id FROM games WHERE game_name = ?', (game_name,))
            existing = cursor.fetchone()

            if existing:
                # 更新现有记录
                # 优先使用直接传递的排名字段（rank_wx, rank_dy, rank_ios, rank_android）
                # 如果没有，则根据平台和来源推断
                updates = []
                params = []

                # 直接传递的排名字段（优先级最高）
                if "rank_wx" in game_info and game_info.get("rank_wx"):
                    updates.append("rank_wx = COALESCE(?, rank_wx)")
                    params.append(str(game_info.get("rank_wx")))
                elif "rank_dy" in game_info and game_info.get("rank_dy"):
                    updates.append("rank_dy = COALESCE(?, rank_dy)")
                    params.append(str(game_info.get("rank_dy")))
                elif "rank_ios" in game_info and game_info.get("rank_ios"):
                    updates.append("rank_ios = COALESCE(?, rank_ios)")
                    params.append(str(game_info.get("rank_ios")))
                elif "rank_android" in game_info and game_info.get("rank_android"):
                    updates.append("rank_android = COALESCE(?, rank_android)")
                    params.append(str(game_info.get("rank_android")))
                else:
                    # 如果没有直接传递，根据平台和来源推断
                    platform = game_info.get("platform", "").strip()
                    source = game_info.get("source", "").strip()
                    rank_value = game_info.get("game_rank") or game_info.get("rank")

                    if rank_value:
                        # 确定排名字段
                        rank_field = None
                        if "微信" in platform or (source == "引力引擎" and "wx" in str(game_info.get("board_name", "")).lower()):
                            rank_field = "rank_wx"
                        elif "抖音" in platform or "dy" in platform.lower():
                            rank_field = "rank_dy"
                        elif source == "SensorTower":
                            if "iOS" in platform or "ios" in platform.lower():
                                rank_field = "rank_ios"
                            elif "Android" in platform or "android" in platform.lower():
                                rank_field = "rank_android"

                        if rank_field:
                            updates.append(f"{rank_field} = COALESCE(?, {rank_field})")
                            params.append(str(rank_value))

                # 保留原有game_rank字段（兼容性）
                if game_info.get("game_rank"):
                    updates.append("game_rank = COALESCE(?, game_rank)")
                    params.append(game_info.get("game_rank"))

                # 其他字段
                updates.extend([
                    "game_company = COALESCE(?, game_company)",
                    "rank_change = COALESCE(?, rank_change)",
                    "platform = COALESCE(?, platform)",
                    "source = COALESCE(?, source)",
                    "board_name = COALESCE(?, board_name)",
                    "monitor_date = COALESCE(?, monitor_date)",
                    "aweme_id = COALESCE(?, aweme_id)",
                    "title = COALESCE(?, title)",
                    "description = COALESCE(?, description)",
                    "video_url = COALESCE(?, video_url)",
                    "video_urls = COALESCE(?, video_urls)",
                    "cover_url = COALESCE(?, cover_url)",
                    "author_uid = COALESCE(?, author_uid)",
                    "duration = COALESCE(?, duration)",
                    "like_count = COALESCE(?, like_count)",
                    "comment_count = COALESCE(?, comment_count)",
                    "play_count = COALESCE(?, play_count)",
                    "create_time = COALESCE(?, create_time)",
                    "share_url = COALESCE(?, share_url)",
                    "original_video_url = COALESCE(?, original_video_url)",
                    "gdrive_url = COALESCE(?, gdrive_url)",
                    "gdrive_file_id = COALESCE(?, gdrive_file_id)",
                    "search_keyword = COALESCE(?, search_keyword)",
                    "relevance_score = COALESCE(?, relevance_score)",
                    "gameplay_analysis = COALESCE(?, gameplay_analysis)",
                    "analysis_model = COALESCE(?, analysis_model)",
                    "analyzed_at = COALESCE(?, analyzed_at)",
                    "screenshot_image_key = COALESCE(?, screenshot_image_key)",
                    "updated_at = CURRENT_TIMESTAMP"
                ])
                params.extend([
                    game_info.get("game_company"),
                    game_info.get("rank_change"),
                    game_info.get("platform"),
                    game_info.get("source"),
                    game_info.get("board_name"),
                    game_info.get("monitor_date"),
                    game_info.get("aweme_id"),
                    game_info.get("title"),
                    game_info.get("description"),
                    game_info.get("video_url"),
                    video_urls_json,
                    game_info.get("cover_url"),
                    game_info.get("author_uid"),
                    game_info.get("duration"),
                    game_info.get("like_count"),
                    game_info.get("comment_count"),
                    game_info.get("play_count"),
                    game_info.get("create_time"),
                    game_info.get("share_url"),
                    game_info.get("original_video_url"),
                    game_info.get("gdrive_url"),
                    game_info.get("gdrive_file_id"),
                    game_info.get("search_keyword"),
                    game_info.get("relevance_score"),
                    game_info.get("gameplay_analysis"),
                    game_info.get("analysis_model"),
                    game_info.get("analyzed_at"),
                    screenshot_key
                ])
                params.append(game_name)

                cursor.execute(f'''
                    UPDATE games SET {', '.join(updates)}
                    WHERE game_name = ?
                ''', params)
            else:
                # 插入新记录
                # 优先使用直接传递的排名字段
                rank_wx = str(game_info.get("rank_wx")) if game_info.get("rank_wx") else None
                rank_dy = str(game_info.get("rank_dy")) if game_info.get("rank_dy") else None
                rank_ios = str(game_info.get("rank_ios")) if game_info.get("rank_ios") else None
                rank_android = str(game_info.get("rank_android")) if game_info.get("rank_android") else None

                # 如果没有直接传递，根据平台和来源推断
                if not any([rank_wx, rank_dy, rank_ios, rank_android]):
                    platform = game_info.get("platform", "").strip()
                    source = game_info.get("source", "").strip()
                    rank_value = game_info.get("game_rank") or game_info.get("rank")

                    if "微信" in platform or (source == "引力引擎" and "wx" in str(game_info.get("board_name", "")).lower()):
                        rank_wx = str(rank_value) if rank_value else None
                    elif "抖音" in platform or "dy" in platform.lower():
                        rank_dy = str(rank_value) if rank_value else None
                    elif source == "SensorTower":
                        if "iOS" in platform or "ios" in platform.lower():
                            rank_ios = str(rank_value) if rank_value else None
                        elif "Android" in platform or "android" in platform.lower():
                            rank_android = str(rank_value) if rank_value else None

                cursor.execute('''
                    INSERT INTO games (
                        game_name, game_rank, game_company, rank_change,
                        platform, source, board_name, monitor_date,
                        rank_wx, rank_dy, rank_ios, rank_android,
                        aweme_id, title, description,
                        video_url, video_urls, cover_url,
                        author_uid, duration,
                        like_count, comment_count, play_count,
                        create_time, share_url, original_video_url, gdrive_url, gdrive_file_id,
                        local_path, downloaded, search_keyword, relevance_score,
                        gameplay_analysis, analysis_model, analyzed_at, screenshot_image_key
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    game_name,
                    game_info.get("game_rank"),  # 保留原有字段（兼容性）
                    game_info.get("game_company"),
                    game_info.get("rank_change"),
                    game_info.get("platform"),
                    game_info.get("source"),
                    game_info.get("board_name"),
                    game_info.get("monitor_date"),
                    rank_wx,
                    rank_dy,
                    rank_ios,
                    rank_android,
                    game_info.get("aweme_id"),
                    game_info.get("title"),
                    game_info.get("description"),
                    game_info.get("video_url"),
                    video_urls_json,
                    game_info.get("cover_url"),
                    game_info.get("author_uid"),
                    game_info.get("duration"),
                    game_info.get("like_count", 0),
                    game_info.get("comment_count", 0),
                    game_info.get("play_count", 0),
                    game_info.get("create_time"),
                    game_info.get("share_url"),
                    game_info.get("original_video_url"),
                    game_info.get("gdrive_url"),
                    game_info.get("gdrive_file_id"),
                    game_info.get("local_path"),
                    game_info.get("downloaded", 0),
                    game_info.get("search_keyword"),
                    game_info.get("relevance_score", 0),
                    game_info.get("gameplay_analysis"),
                    game_info.get("analysis_model"),
                    game_info.get("analyzed_at"),
                    screenshot_key
                ))

            conn.commit()
            conn.close()
            return True

        except Exception as e:
            print(f"保存游戏到数据库时出错：{str(e)}")
            return False

    def update_game_ranking(
        self,
        game_name: str,
        game_rank: str = None,
        game_company: str = None,
        rank_change: str = None,
        platform: str = None,
        source: str = None,
        board_name: str = None,
        monitor_date: str = None,
    ) -> bool:
        """
        更新游戏的排名信息

        Args:
            game_name: 游戏名称
            game_rank: 排名
            game_company: 开发公司
            rank_change: 排名变化

        Returns:
            是否更新成功
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            updates = []
            params = []

            if game_rank is not None:
                updates.append("game_rank = ?")
                params.append(game_rank)
            if game_company is not None:
                updates.append("game_company = ?")
                params.append(game_company)
            if rank_change is not None:
                updates.append("rank_change = ?")
                params.append(rank_change)
            if platform is not None:
                updates.append("platform = ?")
                params.append(platform)
            if source is not None:
                updates.append("source = ?")
                params.append(source)
            if board_name is not None:
                updates.append("board_name = ?")
                params.append(board_name)
            if monitor_date is not None:
                updates.append("monitor_date = ?")
                params.append(monitor_date)

            if not updates:
                conn.close()
                return False

            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(game_name)

            cursor.execute(f'''
                UPDATE games SET {', '.join(updates)}
                WHERE game_name = ?
            ''', params)

            conn.commit()
            conn.close()
            return True

        except Exception as e:
            print(f"更新游戏排名时出错：{str(e)}")
            return False

    def update_download_status(self, game_name: str, local_path: str, gdrive_url: str = None, gdrive_file_id: str = None):
        """
        更新游戏视频下载状态

        Args:
            game_name: 游戏名称
            local_path: 本地文件路径
            gdrive_url: Google Drive公开访问链接（可选）
            gdrive_file_id: Google Drive文件ID（可选）
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            if gdrive_url and gdrive_file_id:
                cursor.execute('''
                    UPDATE games SET
                        local_path = ?,
                        downloaded = 1,
                        gdrive_url = COALESCE(?, gdrive_url),
                        gdrive_file_id = COALESCE(?, gdrive_file_id),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE game_name = ?
                ''', (local_path, gdrive_url, gdrive_file_id, game_name))
            else:
                cursor.execute('''
                    UPDATE games SET
                        local_path = ?,
                        downloaded = 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE game_name = ?
                ''', (local_path, game_name))

            conn.commit()
            conn.close()

        except Exception as e:
            print(f"更新下载状态时出错：{str(e)}")

    def update_screenshot_key(self, game_name: str, screenshot_image_keys) -> bool:
        """
        更新游戏的截图image_key（支持多个）

        Args:
            game_name: 游戏名称
            screenshot_image_keys: 飞书截图image_key（字符串或列表），如果是列表会转为JSON字符串

        Returns:
            是否更新成功
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # 如果是列表，转为JSON字符串
            if isinstance(screenshot_image_keys, list):
                screenshot_image_key_str = json.dumps(screenshot_image_keys, ensure_ascii=False)
            else:
                screenshot_image_key_str = screenshot_image_keys

            cursor.execute('''
                UPDATE games SET
                    screenshot_image_key = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE game_name = ?
            ''', (screenshot_image_key_str, game_name))

            conn.commit()
            conn.close()

            return True

        except Exception as e:
            print(f"更新截图key时出错：{str(e)}")
            return False

    def get_screenshot_key(self, game_name: str) -> Optional[List[str]]:
        """
        获取游戏的截图image_key列表（如果已上传）

        Args:
            game_name: 游戏名称

        Returns:
            screenshot_image_key列表，如果不存在返回None
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute('''
                SELECT screenshot_image_key
                FROM games
                WHERE game_name = ? AND screenshot_image_key IS NOT NULL AND screenshot_image_key != ''
            ''', (game_name,))

            row = cursor.fetchone()
            conn.close()

            if row:
                screenshot_key_str = row["screenshot_image_key"]
                # 尝试解析为JSON（如果是列表）
                try:
                    screenshot_keys = json.loads(screenshot_key_str)
                    if isinstance(screenshot_keys, list):
                        return screenshot_keys
                    else:
                        # 如果是单个字符串，返回列表
                        return [screenshot_keys]
                except (json.JSONDecodeError, TypeError):
                    # 如果不是JSON，当作单个字符串处理
                    return [screenshot_key_str]
            return None

        except Exception as e:
            print(f"获取截图key时出错：{str(e)}")
            return None

    def get_game(self, game_name: str) -> Optional[Dict]:
        """
        根据游戏名称获取游戏信息

        Args:
            game_name: 游戏名称

        Returns:
            游戏信息字典，如果不存在返回None
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute('SELECT * FROM games WHERE game_name = ?', (game_name,))
            row = cursor.fetchone()

            conn.close()

            if row:
                return self._row_to_dict(row)
            return None

        except Exception as e:
            print(f"获取游戏信息时出错：{str(e)}")
            return None

    def get_all_games(self, limit: int = None) -> List[Dict]:
        """
        获取所有游戏

        Args:
            limit: 限制返回数量

        Returns:
            游戏信息列表
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            if limit:
                cursor.execute('SELECT * FROM games ORDER BY created_at DESC LIMIT ?', (limit,))
            else:
                cursor.execute('SELECT * FROM games ORDER BY created_at DESC')

            rows = cursor.fetchall()
            conn.close()

            return [self._row_to_dict(row) for row in rows]

        except Exception as e:
            print(f"获取所有游戏时出错：{str(e)}")
            return []

    def _row_to_dict(self, row: sqlite3.Row) -> Dict:
        """
        将数据库行转换为字典

        Args:
            row: 数据库行

        Returns:
            字典
        """
        result = dict(row)

        # 解析video_urls JSON
        if result.get("video_urls"):
            try:
                result["video_urls"] = json.loads(result["video_urls"])
            except:
                result["video_urls"] = []
        else:
            result["video_urls"] = []

        return result

    def get_gameplay_analysis(self, game_name: str) -> Optional[Dict]:
        """
        获取游戏的玩法分析结果（如果已分析过）

        Args:
            game_name: 游戏名称

        Returns:
            分析结果字典，包含gameplay_analysis和analysis_model，如果不存在返回None
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute('''
                SELECT gameplay_analysis, analysis_model, analyzed_at
                FROM games
                WHERE game_name = ? AND gameplay_analysis IS NOT NULL AND gameplay_analysis != ''
            ''', (game_name,))

            row = cursor.fetchone()
            conn.close()

            if row:
                return {
                    "gameplay_analysis": row["gameplay_analysis"],
                    "analysis_model": row["analysis_model"],
                    "analyzed_at": row["analyzed_at"]
                }
            return None

        except Exception as e:
            print(f"获取玩法分析时出错：{str(e)}")
            return None

    def save_gameplay_analysis(self, game_name: str, analysis_text: str, model_used: str) -> bool:
        """
        保存游戏的玩法分析结果到数据库

        Args:
            game_name: 游戏名称
            analysis_text: 分析结果文本
            model_used: 使用的模型

        Returns:
            是否保存成功
        """
        try:
            from datetime import datetime

            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE games SET
                    gameplay_analysis = ?,
                    analysis_model = ?,
                    analyzed_at = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE game_name = ?
            ''', (analysis_text, model_used, datetime.now(), game_name))

            conn.commit()
            conn.close()

            return True

        except Exception as e:
            print(f"保存玩法分析时出错：{str(e)}")
            return False

    def clear_gameplay_analysis(self, game_name: str) -> int:
        """
        清除指定游戏的AI玩法分析（保留视频等其他数据）

        Args:
            game_name: 游戏名称

        Returns:
            受影响的记录数
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('''
                UPDATE games SET
                    gameplay_analysis = NULL,
                    analysis_model = NULL,
                    analyzed_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE game_name = ? AND gameplay_analysis IS NOT NULL AND gameplay_analysis != ''
            ''', (game_name,))

            count = cursor.rowcount
            conn.commit()
            conn.close()

            if count > 0:
                print(f"已清除游戏 '{game_name}' 的AI分析结果")
            else:
                print(f"未找到需要清除分析结果的记录：'{game_name}'")

            return count

        except Exception as e:
            print(f"清除玩法分析时出错：{str(e)}")
            return 0

    def clear_all_gameplay_videos(self) -> int:
        """
        清空数据库中所有游戏的“玩法视频相关字段”（不删除游戏记录）。
        用于让工作流下次重新搜索/下载/上传视频。

        注意：
        - 仅清理 videos 相关字段（aweme_id / video_url / gdrive_url / local_path 等）
        - 不会清理 gameplay_analysis（玩法分析缓存），如需清理请单独处理

        Returns:
            受影响的记录数
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute(
                """
                UPDATE games SET
                    aweme_id = NULL,
                    title = NULL,
                    description = NULL,
                    video_url = NULL,
                    video_urls = NULL,
                    cover_url = NULL,
                    author_uid = NULL,
                    duration = NULL,
                    like_count = 0,
                    comment_count = 0,
                    play_count = 0,
                    create_time = NULL,
                    share_url = NULL,
                    original_video_url = NULL,
                    gdrive_url = NULL,
                    gdrive_file_id = NULL,
                    local_path = NULL,
                    downloaded = 0,
                    search_keyword = NULL,
                    relevance_score = 0,
                    screenshot_image_key = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE
                    aweme_id IS NOT NULL
                    OR video_url IS NOT NULL
                    OR (video_urls IS NOT NULL AND video_urls != '')
                    OR cover_url IS NOT NULL
                    OR share_url IS NOT NULL
                    OR original_video_url IS NOT NULL
                    OR gdrive_url IS NOT NULL
                    OR gdrive_file_id IS NOT NULL
                    OR local_path IS NOT NULL
                    OR downloaded != 0
                    OR (search_keyword IS NOT NULL AND search_keyword != '')
                    OR relevance_score != 0
                    OR (screenshot_image_key IS NOT NULL AND screenshot_image_key != '')
                """
            )

            count = cursor.rowcount
            conn.commit()
            conn.close()

            if count > 0:
                print(f"已清空 {count} 条游戏记录的玩法视频字段（保留游戏与分析结果）")
            else:
                print("数据库中未发现需要清理的玩法视频字段")

            return count
        except Exception as e:
            print(f"清空所有玩法视频字段时出错：{str(e)}")
            return 0

    def delete_game_data(self, game_name: str) -> int:
        """
        删除指定游戏的所有数据

        Args:
            game_name: 游戏名称

        Returns:
            删除的记录数
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            cursor.execute('DELETE FROM games WHERE game_name = ?', (game_name,))
            deleted_count = cursor.rowcount
            conn.commit()
            conn.close()

            if deleted_count > 0:
                print(f"已删除游戏 '{game_name}' 的数据")
            else:
                print(f"未找到游戏 '{game_name}' 的数据")

            return deleted_count

        except Exception as e:
            print(f"删除游戏数据时出错：{str(e)}")
            return 0

    def get_statistics(self) -> Dict:
        """
        获取数据库统计信息

        Returns:
            统计信息字典
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # 总游戏数
            cursor.execute('SELECT COUNT(*) FROM games')
            total = cursor.fetchone()[0]

            # 已下载数
            cursor.execute('SELECT COUNT(*) FROM games WHERE downloaded = 1')
            downloaded = cursor.fetchone()[0]

            # 已分析数
            cursor.execute('SELECT COUNT(*) FROM games WHERE gameplay_analysis IS NOT NULL AND gameplay_analysis != ""')
            analyzed = cursor.fetchone()[0]

            conn.close()

            return {
                "total_games": total,
                "downloaded_games": downloaded,
                "analyzed_games": analyzed
            }

        except Exception as e:
            print(f"获取统计信息时出错：{str(e)}")
            return {}

    def insert_weekly_rankings(self, records: List[Dict]) -> int:
        """
        批量插入每周榜单记录到 weekly_rankings 表。
        仅做简单插入，不去重；如需覆盖，请在上层脚本中先清理对应周的数据。

        Args:
            records: 每条记录为一个 dict，键名应与 weekly_rankings 表字段一致或其子集

        Returns:
            实际插入的行数
        """
        if not records:
            return 0

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # weekly_rankings 结构：一行=一周+一平台，ranking 为该组合的完整榜单 JSON
            columns = [
                "week_range",
                "week_start",
                "week_end",
                "platform",
                "source",
                "board_name",
                "region",
                "ranking",
            ]

            def row_from_record(rec: Dict) -> tuple:
                return tuple(rec.get(col) for col in columns)

            rows = [row_from_record(r) for r in records]

            placeholder = ",".join(["?"] * len(columns))
            sql = f'''
                INSERT INTO weekly_rankings (
                    {", ".join(columns)}
                ) VALUES ({placeholder})
            '''
            cursor.executemany(sql, rows)

            conn.commit()
            inserted = cursor.rowcount
            conn.close()
            return inserted
        except Exception as e:
            print(f"批量插入 weekly_rankings 时出错：{str(e)}")
            return 0

    def insert_weekly_report_trends(self, records: List[Dict]) -> int:
        """
        批量插入周报玩法趋势记录到 weekly_report_trends 表。

        Args:
            records: 每条记录为 dict，需含 monitor_date, platform, source, trend_analysis；可选 week_range

        Returns:
            实际插入的行数
        """
        if not records:
            return 0
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            columns = ["monitor_date", "week_range", "platform", "source", "trend_analysis"]
            placeholders = ",".join(["?"] * len(columns))
            sql = f'''
                INSERT INTO weekly_report_trends ({", ".join(columns)})
                VALUES ({placeholders})
            '''
            rows = [tuple(r.get(c) for c in columns) for r in records]
            cursor.executemany(sql, rows)
            conn.commit()
            inserted = cursor.rowcount
            conn.close()
            return inserted
        except Exception as e:
            print(f"批量插入 weekly_report_trends 时出错：{str(e)}")
            return 0

    def insert_weekly_report_simple(self, records: List[Dict]) -> int:
        """
        批量插入周报简单内容到 weekly_report_simple 表（仅新进榜、飙升游戏；玩法仍存 games 表）。

        Args:
            records: 每条为 dict，需含 week_range, platform, game_name, change_type；可选 rank, rank_change, summary

        Returns:
            实际插入的行数
        """
        if not records:
            return 0
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            columns = ["week_range", "platform", "game_name", "change_type", "rank", "rank_change", "summary"]
            placeholders = ",".join(["?"] * len(columns))
            sql = f'''
                INSERT INTO weekly_report_simple ({", ".join(columns)})
                VALUES ({placeholders})
            '''
            rows = [tuple(r.get(c) for c in columns) for r in records]
            cursor.executemany(sql, rows)
            conn.commit()
            inserted = cursor.rowcount
            conn.close()
            return inserted
        except Exception as e:
            print(f"批量插入 weekly_report_simple 时出错：{str(e)}")
            return 0

    # CSV 11 列与 DB 列名映射（中文表头 -> 英文字段名）
    _RANKING_CSV_COLUMNS = [
        ("排名", "rank"),
        ("游戏名称", "game_name"),
        ("游戏类型", "game_type"),
        ("平台", "platform"),
        ("来源", "source"),
        ("榜单", "board_name"),
        ("监控日期", "monitor_date"),
        ("发布时间", "publish_time"),
        ("开发公司", "company"),
        ("排名变化", "rank_change"),
        ("地区", "region"),
    ]

    def _row_to_ranking_tuple(self, row: Dict, week_range: str, platform_key: str, chart_key: str) -> tuple:
        """将 CSV 行（中文 key 或英文 key）转为 top20_ranking/rank_changes 的插入元组。"""
        out = [week_range, platform_key, chart_key]
        for cn, en in self._RANKING_CSV_COLUMNS:
            val = row.get(cn) or row.get(en) or ""
            out.append(val if isinstance(val, str) else str(val))
        return tuple(out)

    def insert_top20_ranking(self, week_range: str, platform_key: str, chart_key: str, rows: List[Dict]) -> int:
        """
        将每周 full 榜写入 top20_ranking 表。CSV 11 列 + 元数据。
        同一 (week_range, platform_key, chart_key) 会先删后插。

        Args:
            week_range: 周范围，如 2026-02-02~2026-02-08
            platform_key: wx 或 dy
            chart_key: popularity / bestseller / casual_play（微信畅玩）/ new_games（抖音新游）
            rows: 列表，每项为 dict，含 11 个字段（中文或英文字段名均可）

        Returns:
            插入行数
        """
        if not rows:
            return 0
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM top20_ranking WHERE week_range = ? AND platform_key = ? AND chart_key = ?",
                (week_range, platform_key, chart_key),
            )
            cols = ["week_range", "platform_key", "chart_key"] + [en for _, en in self._RANKING_CSV_COLUMNS]
            placeholders = ",".join(["?"] * len(cols))
            sql = f"INSERT INTO top20_ranking ({', '.join(cols)}) VALUES ({placeholders})"
            tuples = [self._row_to_ranking_tuple(r, week_range, platform_key, chart_key) for r in rows]
            cursor.executemany(sql, tuples)
            conn.commit()
            n = cursor.rowcount
            conn.close()
            return n
        except Exception as e:
            print(f"批量插入 top20_ranking 时出错：{str(e)}")
            return 0

    def insert_rank_changes(self, week_range: str, platform_key: str, chart_key: str, rows: List[Dict]) -> int:
        """
        将每周异动榜写入 rank_changes 表。CSV 11 列 + 元数据。
        同一 (week_range, platform_key, chart_key) 会先删后插。

        Args:
            week_range: 周范围，如 2026-02-02~2026-02-08
            platform_key: wx 或 dy
            chart_key: popularity / bestseller / casual_play（微信畅玩）/ new_games（抖音新游）
            rows: 列表，每项为 dict，含 11 个字段（中文或英文字段名均可）

        Returns:
            插入行数
        """
        if not rows:
            return 0
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM rank_changes WHERE week_range = ? AND platform_key = ? AND chart_key = ?",
                (week_range, platform_key, chart_key),
            )
            cols = ["week_range", "platform_key", "chart_key"] + [en for _, en in self._RANKING_CSV_COLUMNS]
            placeholders = ",".join(["?"] * len(cols))
            sql = f"INSERT INTO rank_changes ({', '.join(cols)}) VALUES ({placeholders})"
            tuples = [self._row_to_ranking_tuple(r, week_range, platform_key, chart_key) for r in rows]
            cursor.executemany(sql, tuples)
            conn.commit()
            n = cursor.rowcount
            conn.close()
            return n
        except Exception as e:
            print(f"批量插入 rank_changes 时出错：{str(e)}")
            return 0

    def get_weekly_report_simple_by_game(self, game_name: str) -> List[Dict]:
        """
        根据游戏名获取该游戏在周报简表（weekly_report_simple）中的所有记录。
        主要用于对外提供“玩法周报相关数据”（排名、排名变化、平台、周范围等）。

        Args:
            game_name: 游戏名称（需与 weekly_report_simple.game_name 一致）

        Returns:
            按 week_range、platform 排序的记录列表，每条为 dict：
            {
                "week_range": ...,
                "platform": ...,
                "game_name": ...,
                "change_type": ...,
                "rank": ...,
                "rank_change": ...,
                "summary": ...,
                "created_at": ...,
            }
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT week_range, platform, game_name, change_type,
                       rank, rank_change, summary, created_at
                FROM weekly_report_simple
                WHERE game_name = ?
                ORDER BY week_range, platform, created_at
                """,
                (game_name,),
            )
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]
        except Exception as e:
            print(f"按游戏名查询 weekly_report_simple 时出错：{str(e)}")
            return []

    def delete_weekly_report_simple_by_week(self, week_range: str) -> int:
        """删除指定 week_range 的 weekly_report_simple 记录，返回删除行数。"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM weekly_report_simple WHERE week_range = ?", (week_range,))
            deleted = cursor.rowcount
            conn.commit()
            conn.close()
            return deleted
        except Exception as e:
            print(f"删除 weekly_report_simple 时出错：{str(e)}")
            return 0

    def get_last_week_trends_by_platform(self, before_monitor_date: str) -> Dict[str, str]:
        """
        获取某监控日期之前最近一周的各平台趋势分析文本，用于与本周对比。
        取「当前监控日期之前」最近一次的 monitor_date，再取该日期的各平台趋势，保证是同一周。

        Args:
            before_monitor_date: 监控日期（YYYY-MM-DD），取该日期之前的最近一周周报

        Returns:
            dict，key 为 platform（wx/dy/ios/android），value 为该平台上周的 trend_analysis 文本
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT monitor_date FROM weekly_report_trends
                WHERE monitor_date < ?
                ORDER BY monitor_date DESC LIMIT 1
            ''', (before_monitor_date,))
            row = cursor.fetchone()
            if not row:
                conn.close()
                return {}
            last_date = row["monitor_date"]
            cursor.execute('''
                SELECT platform, trend_analysis
                FROM weekly_report_trends
                WHERE monitor_date = ?
            ''', (last_date,))
            rows = cursor.fetchall()
            conn.close()
            return {r["platform"]: (r["trend_analysis"] or "") for r in rows}
        except Exception as e:
            print(f"查询上周趋势时出错：{str(e)}")
            return {}

    @staticmethod
    def normalize_week_range(week_range: str) -> str:
        """
        将 week_range 规范为与数据库一致：YYYY-M-D~YYYY-M-D（月、日无前导零）。
        导入脚本写入的格式为 2026-1-19~2026-1-25，查询时用同一格式才能命中。
        """
        if not week_range or "~" not in week_range:
            return week_range or ""
        parts = week_range.split("~", 1)
        if len(parts) != 2:
            return week_range
        out = []
        for s in parts:
            s = (s or "").strip()
            if "-" in s:
                segs = s.split("-")
                if len(segs) == 3:
                    try:
                        y, m, d = int(segs[0]), int(segs[1]), int(segs[2])
                        out.append(f"{y}-{m}-{d}")
                    except ValueError:
                        out.append(s)
                else:
                    out.append(s)
            else:
                out.append(s)
        return "~".join(out) if len(out) == 2 else week_range

    def get_distinct_week_ranges(self) -> List[str]:
        """返回 weekly_rankings 表中所有不同的 week_range 值（用于诊断对比）。"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT week_range FROM weekly_rankings ORDER BY week_range")
            rows = cursor.fetchall()
            conn.close()
            return [r[0] for r in rows if r and r[0]]
        except Exception as e:
            print(f"  [诊断] 查询 distinct week_range 时出错：{e}")
            return []

    def get_latest_week_range(self) -> Optional[str]:
        """
        获取 weekly_rankings 中最近一周的 week_range。

        Returns:
            例如 "2026-1-19~2026-1-25"，无数据时返回 None。
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT week_range FROM weekly_rankings
                ORDER BY week_end DESC, week_start DESC, id DESC
                LIMIT 1
            ''')
            row = cursor.fetchone()
            conn.close()
            return row[0] if row and row[0] else None
        except Exception as e:
            print(f"查询最近周范围时出错：{str(e)}")
            return None

    def get_ranking_game_counts_by_platform(self, week_range: str) -> Dict[str, int]:
        """
        返回指定周各平台榜单中的游戏数量（仅从 weekly_rankings 解析，不查 games）。
        用于诊断：榜单有数据但无玩法时，提示用户本周各平台有多少款游戏。
        """
        week_range = self.normalize_week_range(week_range or "")
        out: Dict[str, int] = {}
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT platform, ranking FROM weekly_rankings WHERE week_range = ? ORDER BY platform",
                (week_range,),
            )
            rows = cursor.fetchall()
            conn.close()
            for (platform, ranking_raw) in rows:
                if not platform or not ranking_raw:
                    continue
                platform = (platform or "").strip()
                try:
                    data = json.loads(ranking_raw) if isinstance(ranking_raw, str) else ranking_raw
                except Exception:
                    continue
                count = 0
                if isinstance(data, list):
                    count = sum(1 for r in data if isinstance(r, dict) and (r.get("游戏名称") or r.get("游戏名")))
                elif isinstance(data, dict):
                    rows_list = data.get("rows") or []
                    name_col = "游戏名称" if "游戏名称" in (data.get("header") or []) else "游戏名"
                    count = sum(1 for r in rows_list if isinstance(r, dict) and r.get(name_col))
                if platform:
                    out[platform] = count
        except Exception as e:
            print(f"查询榜单游戏数时出错：{str(e)}")
        return out

    def get_sample_game_names_with_gameplay(self, limit: int = 10) -> List[str]:
        """返回 games 表中有 gameplay_analysis 的游戏名示例，用于诊断名称是否与榜单一致。"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT game_name FROM games WHERE gameplay_analysis IS NOT NULL AND gameplay_analysis != '' LIMIT ?",
                (limit,),
            )
            rows = cursor.fetchall()
            conn.close()
            return [r[0] for r in rows if r and r[0]]
        except Exception as e:
            print(f"  [诊断] 查询有玩法的游戏名示例时出错：{e}")
            return []

    def get_gameplay_by_platform_for_week(self, week_range: str, debug: bool = False) -> Dict[str, List[Dict]]:
        """
        从数据库中提取指定周各平台排行榜的游戏玩法。
        仅按游戏名（game_name）从 games 表取 gameplay_analysis，按平台汇总。

        Args:
            week_range: 周范围，如 "2026-1-19~2026-1-25"
            debug: 为 True 时打印诊断信息

        Returns:
            {
                "wx": [{"game_name": "...", "gameplay_analysis": "...", "rank_change": "..."}, ...],
                "dy": [...], "ios": [...], "android": [...]
            }
            榜单中无玩法分析的游戏会跳过；无数据的平台 key 不出现或为空列表。
        """
        week_range = self.normalize_week_range(week_range or "")
        out: Dict[str, List[Dict]] = {}
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT platform, source, board_name, ranking
                FROM weekly_rankings
                WHERE week_range = ?
                ORDER BY platform
            ''', (week_range,))
            rows = cursor.fetchall()
            if debug:
                # 先查 DB 里实际存在的 week_range，便于与匹配串对比
                cursor.execute("SELECT DISTINCT week_range FROM weekly_rankings ORDER BY week_range")
                db_week_ranges = [r[0] for r in cursor.fetchall() if r and r[0]]
                print(f"  [诊断] DB 中 weekly_rankings 表里实际存在的 week_range 值: {[repr(w) for w in db_week_ranges]}")
                print(f"  [诊断] 代码用于匹配的字符串: {repr(week_range)} (len={len(week_range)})")
                if db_week_ranges and week_range not in db_week_ranges:
                    print(f"  [诊断] 匹配串不在上列中！逐字符对比首条 DB 值:")
                    ref = db_week_ranges[0]
                    for i, (a, b) in enumerate(zip(ref, week_range)):
                        if a != b:
                            print(f"    位置 {i}: DB={repr(a)} ord={ord(a)} 代码={repr(b)} ord={ord(b)}")
                    if len(ref) != len(week_range):
                        print(f"    长度: DB={len(ref)} 代码={len(week_range)}")
                print(f"  [诊断] WHERE week_range = ? 查询得到 {len(rows)} 条记录")
            if not rows:
                conn.close()
                return out

            def game_names_and_rank_changes_from_ranking(ranking_raw) -> List[tuple]:
                """从 ranking JSON 解析出 (游戏名称, 排名变化) 列表。支持 list 或 {header, rows}。"""
                if not ranking_raw:
                    return []
                try:
                    data = json.loads(ranking_raw) if isinstance(ranking_raw, str) else ranking_raw
                except Exception:
                    return []
                items = []
                if isinstance(data, list):
                    for row in data:
                        if isinstance(row, dict):
                            name = (row.get("游戏名称") or row.get("游戏名") or "").strip()
                            rc = (row.get("排名变化") or "").strip()
                            if name:
                                items.append((name, rc))
                elif isinstance(data, dict):
                    header = data.get("header") or []
                    rows_list = data.get("rows") or []
                    name_col = "游戏名称" if "游戏名称" in header else "游戏名"
                    rc_col = "排名变化" if "排名变化" in header else ""
                    for r in rows_list:
                        if isinstance(r, dict):
                            name = (r.get(name_col) or "").strip()
                            rc = (r.get(rc_col) or "").strip() if rc_col else ""
                            if name:
                                items.append((name, rc))
                return items

            for r in rows:
                platform = (r["platform"] or "").strip() or None
                if not platform:
                    continue
                ranking_raw = r["ranking"]
                pairs = game_names_and_rank_changes_from_ranking(ranking_raw)
                if not pairs:
                    out[platform] = []
                    continue
                # 榜单中的游戏名已 strip；games 表可能含首尾空格，用 TRIM 匹配
                game_names = [p[0] for p in pairs]
                rank_change_by_name = {p[0]: p[1] for p in pairs}
                game_names_trimmed = [n.strip() for n in game_names if n]

                if not game_names_trimmed:
                    out[platform] = []
                    continue

                placeholders = ",".join(["?"] * len(game_names_trimmed))
                cursor.execute(f'''
                    SELECT TRIM(game_name) AS game_name, gameplay_analysis
                    FROM games
                    WHERE TRIM(game_name) IN ({placeholders})
                    AND gameplay_analysis IS NOT NULL AND gameplay_analysis != ''
                ''', game_names_trimmed)
                db_rows = cursor.fetchall()
                gameplay_by_name = {row["game_name"]: (row["gameplay_analysis"] or "").strip() for row in db_rows}

                list_for_platform = []
                for name in game_names:
                    key = name.strip()
                    analysis = gameplay_by_name.get(key)
                    if not analysis:
                        continue
                    list_for_platform.append({
                        "game_name": name,
                        "gameplay_analysis": analysis,
                        "rank_change": rank_change_by_name.get(name, ""),
                    })
                out[platform] = list_for_platform
                if debug:
                    in_rank = len(pairs)
                    matched = len(list_for_platform)
                    print(f"  [诊断] 平台 {platform}: 榜单解析出 {in_rank} 个游戏名，按游戏名匹配到 {matched} 条玩法")
                    if in_rank > 0 and matched == 0:
                        print(f"  [诊断]   榜单游戏名示例: {[repr(p[0]) for p in pairs[:3]]}")

            conn.close()
        except Exception as e:
            print(f"按周按平台获取玩法时出错：{str(e)}")
        return out

    def get_latest_weekly_report_trends(self) -> List[Dict]:
        """
        获取最近一次写入的周报玩法趋势（按 monitor_date 最新），用于单独执行 step5 时发送趋势周报。

        Returns:
            各平台趋势记录列表，每项含 monitor_date, week_range, platform, source, trend_analysis；
            无数据时返回空列表。
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT monitor_date FROM weekly_report_trends
                ORDER BY monitor_date DESC, id DESC LIMIT 1
            ''')
            row = cursor.fetchone()
            if not row:
                conn.close()
                return []
            latest_date = row["monitor_date"]
            cursor.execute('''
                SELECT monitor_date, week_range, platform, source, trend_analysis
                FROM weekly_report_trends
                WHERE monitor_date = ?
                ORDER BY platform
            ''', (latest_date,))
            rows = cursor.fetchall()
            conn.close()
            return [
                {
                    "monitor_date": r["monitor_date"],
                    "week_range": r["week_range"] or "",
                    "platform": r["platform"] or "",
                    "source": r["source"] or "",
                    "trend_analysis": r["trend_analysis"] or "",
                }
                for r in rows
            ]
        except Exception as e:
            print(f"查询最近周报趋势时出错：{str(e)}")
            return []

    # 兼容旧方法名（向后兼容）
    def save_video(self, video_info: Dict) -> bool:
        """兼容旧方法名，实际调用save_game"""
        return self.save_game(video_info)

    def get_video(self, aweme_id: str) -> Optional[Dict]:
        """兼容旧方法名，根据aweme_id查找游戏（不推荐使用）"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute('SELECT * FROM games WHERE aweme_id = ?', (aweme_id,))
            row = cursor.fetchone()

            conn.close()

            if row:
                return self._row_to_dict(row)
            return None

        except Exception as e:
            print(f"获取视频信息时出错：{str(e)}")
            return None

    def get_videos_by_game(self, game_name: str) -> List[Dict]:
        """兼容旧方法名，实际返回单个游戏的列表（因为现在每个游戏只有一条记录）"""
        game = self.get_game(game_name)
        return [game] if game else []

    def get_video_by_game_name(self, game_name: str) -> Optional[Dict]:
        """兼容旧方法名，实际调用get_game"""
        return self.get_game(game_name)
