"""
竞品监控历史数据库
按日期和公司存储爬取数据和AI分析结果
支持 JSON 文件和 SQLite 数据库两种存储方式
"""
import json
import os
from datetime import datetime, date
from typing import Any, Dict, List, Optional
from pathlib import Path


class CompetitorHistoryDB:
    """竞品历史数据库，支持 JSON 文件和 SQLite 数据库两种存储方式"""

    def __init__(self, db_dir: str = None, use_database: bool = None):
        """
        初始化数据库

        Args:
            db_dir: 数据库目录路径，默认为 /app/db 或项目根目录下的 db
            use_database: 是否使用 SQLite 数据库，默认为 None（从环境变量读取，如果未设置则使用 JSON）
        """
        # 决定使用数据库还是 JSON
        if use_database is None:
            use_database = os.environ.get("COMPETITOR_USE_DATABASE", "").lower() in ("true", "1", "yes")

        self.use_database = use_database

        if self.use_database:
            # 使用数据库模式
            try:
                from database.competitor_db import CompetitorDatabaseDB
                self.db = CompetitorDatabaseDB()
                print("  ✓ 使用 SQLite 数据库模式")
            except ImportError:
                print("  ⚠️ 无法导入 CompetitorDatabaseDB，回退到 JSON 模式")
                self.use_database = False
                self.db = None

        if not self.use_database:
            # 使用 JSON 文件模式
            if db_dir is None:
                # 优先使用环境变量指定的目录
                db_dir = os.environ.get("COMPETITOR_DB_DIR")
                if not db_dir or not os.path.exists(db_dir):
                    # 默认使用项目根目录下的 db/ 目录
                    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    db_dir = os.path.join(project_root, "db")
                    # 如果项目根目录的 db 不存在，尝试 Docker 环境的 /app/db
                    if not os.path.exists(db_dir):
                        docker_db_dir = "/app/db"
                        if os.path.exists(docker_db_dir):
                            db_dir = docker_db_dir
                        else:
                            # 都不存在，创建项目根目录下的 db
                            os.makedirs(db_dir, exist_ok=True)
                if not os.path.exists(db_dir):
                    alt_dir = os.path.join(os.path.dirname(__file__), "db")
                    if os.path.exists(alt_dir):
                        db_dir = alt_dir
                    else:
                        # 创建默认目录
                        db_dir = alt_dir
            self.db_dir = db_dir
            os.makedirs(self.db_dir, exist_ok=True)

            # 数据目录结构
            self.raw_data_dir = os.path.join(self.db_dir, "raw_data")  # 原始爬取数据
            self.ai_analysis_dir = os.path.join(self.db_dir, "ai_analysis")  # AI分析结果
            self.daily_report_dir = os.path.join(self.db_dir, "daily_report")  # 日报JSON
            os.makedirs(self.raw_data_dir, exist_ok=True)
            os.makedirs(self.ai_analysis_dir, exist_ok=True)
            os.makedirs(self.daily_report_dir, exist_ok=True)

    def _get_date_str(self, dt: Optional[date] = None) -> str:
        """获取日期字符串 YYYY-MM-DD"""
        if dt is None:
            dt = date.today()
        return dt.strftime("%Y-%m-%d")

    def _get_file_path(self, date_str: str, is_ai: bool = False) -> str:
        """
        获取存储文件路径（按日期存储，每天一个文件）
        注意：仅在 JSON 模式下使用

        Args:
            date_str: 日期字符串 YYYY-MM-DD
            is_ai: 是否为AI分析数据

        Returns:
            文件路径
        """
        if self.use_database:
            # 数据库模式下不应该调用此方法
            raise RuntimeError("_get_file_path 不应在数据库模式下调用")

        base_dir = self.ai_analysis_dir if is_ai else self.raw_data_dir
        filename = f"{date_str}.json"
        return os.path.join(base_dir, filename)

    def save_raw_data(
        self,
        company: str,
        platforms_data: List[Dict[str, Any]],
        fetch_date: Optional[date] = None
    ) -> str:
        """
        保存原始爬取数据（按日期存储，每天一个文件包含所有公司）

        Args:
            company: 公司名称
            platforms_data: 各平台的数据列表，每个元素包含：
                - platform_type: 平台类型（twitter, tiktok, youtube, facebook等）
                - game: 游戏名称（可选）
                - url: 账号URL
                - posts: 帖子列表
                - posts_count: 帖子数量
                - fetched_at: 抓取时间
            fetch_date: 抓取日期，默认为今天

        Returns:
            保存的文件路径或表名
        """
        if self.use_database:
            # 使用数据库模式
            success = self.db.save_raw_data(company, platforms_data, fetch_date)
            return self.db._get_table_name(company) if success else ""

        # 使用 JSON 文件模式
        date_str = self._get_date_str(fetch_date)
        file_path = self._get_file_path(date_str, is_ai=False)

        # 加载已有数据（如果存在）
        existing_data = self.load_raw_data_by_date(fetch_date) or {}

        # 获取或创建该公司的数据
        companies_dict = existing_data.get("companies", {})
        if company not in companies_dict:
            companies_dict[company] = {
                "company": company,
                "platforms": {}
            }

        company_data = companies_dict[company]
        platforms_dict = company_data.get("platforms", {})

        # 合并数据（按平台组织）
        for platform_data in platforms_data:
            platform_type = platform_data.get("platform_type", "unknown")
            game = platform_data.get("game")

            # 平台+游戏的组合键
            key = f"{platform_type}"
            if game:
                key = f"{platform_type}_{game}"

            platforms_dict[key] = {
                "platform_type": platform_type,
                "game": game,
                "url": platform_data.get("url", ""),
                "username": platform_data.get("username"),
                "page_id": platform_data.get("page_id"),
                "channel_id": platform_data.get("channel_id"),
                "posts": platform_data.get("posts", []),
                "posts_count": platform_data.get("posts_count", 0),
                "fetched_at": platform_data.get("fetched_at") or datetime.utcnow().isoformat() + "Z",
            }

        company_data["platforms"] = platforms_dict

        # 构建完整数据结构
        data = {
            "date": date_str,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "companies": companies_dict,
        }

        # 保存到文件
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  ✓ 已保存原始数据: {file_path} (公司: {company})")
            return file_path
        except Exception as exc:
            print(f"  ❌ 保存原始数据失败: {exc}")
            return ""

    def load_raw_data_by_date(self, fetch_date: Optional[date] = None) -> Optional[Dict[str, Any]]:
        """
        按日期加载原始爬取数据（包含所有公司）

        Args:
            fetch_date: 日期，默认为今天

        Returns:
            数据字典，如果不存在则返回None
        """
        if self.use_database:
            # 使用数据库模式
            return self.db.load_raw_data_by_date(fetch_date)

        # 使用 JSON 文件模式
        date_str = self._get_date_str(fetch_date)
        file_path = self._get_file_path(date_str, is_ai=False)

        if not os.path.exists(file_path):
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            print(f"  ⚠️ 加载原始数据失败: {exc}")
            return None

    def load_raw_data(self, company: str, fetch_date: Optional[date] = None) -> Optional[Dict[str, Any]]:
        """
        加载指定公司的原始爬取数据（兼容旧接口）

        Args:
            company: 公司名称
            fetch_date: 日期，默认为今天

        Returns:
            数据字典，如果不存在则返回None
        """
        if self.use_database:
            # 使用数据库模式
            return self.db.load_raw_data(company, fetch_date)

        # 使用 JSON 文件模式
        all_data = self.load_raw_data_by_date(fetch_date)
        if not all_data:
            return None

        companies_dict = all_data.get("companies", {})
        company_data = companies_dict.get(company)

        if not company_data:
            return None

        # 转换为旧格式以保持兼容性
        return {
            "company": company,
            "date": all_data.get("date"),
            "fetched_at": all_data.get("fetched_at"),
            "platforms": company_data.get("platforms", {})
        }

    def save_ai_analysis(
        self,
        company: str,
        ai_results: Dict[str, Any],
        analysis_date: Optional[date] = None
    ) -> str:
        """
        保存AI分析结果（按日期存储，每天一个文件包含所有公司）

        Args:
            company: 公司名称
            ai_results: AI分析结果字典，格式为 {title: payload, ...}
            analysis_date: 分析日期，默认为今天

        Returns:
            保存的文件路径
        """
        date_str = self._get_date_str(analysis_date)
        file_path = self._get_file_path(date_str, is_ai=True)

        # 加载已有数据（如果存在）
        existing_data = self.load_ai_analysis_by_date(analysis_date) or {}

        # 获取或创建该公司的数据
        companies_dict = existing_data.get("companies", {})
        companies_dict[company] = {
            "company": company,
            "results": ai_results,  # 保持原有的 {title: payload} 结构
        }

        # 构建完整数据结构
        data = {
            "date": date_str,
            "analyzed_at": datetime.utcnow().isoformat() + "Z",
            "companies": companies_dict,
        }

        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  ✓ 已保存AI分析结果: {file_path} (公司: {company})")
            return file_path
        except Exception as exc:
            print(f"  ❌ 保存AI分析结果失败: {exc}")
            return ""

    def load_ai_analysis_by_date(self, analysis_date: Optional[date] = None) -> Optional[Dict[str, Any]]:
        """
        按日期加载AI分析结果（包含所有公司）

        Args:
            analysis_date: 日期，默认为今天

        Returns:
            数据字典，如果不存在则返回None
        """
        date_str = self._get_date_str(analysis_date)
        file_path = self._get_file_path(date_str, is_ai=True)

        if not os.path.exists(file_path):
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            print(f"  ⚠️ 加载AI分析结果失败: {exc}")
            return None

    def load_ai_analysis(self, company: str, analysis_date: Optional[date] = None) -> Optional[Dict[str, Any]]:
        """
        加载指定公司的AI分析结果（兼容旧接口）

        Args:
            company: 公司名称
            analysis_date: 日期，默认为今天

        Returns:
            数据字典，如果不存在则返回None
        """
        all_data = self.load_ai_analysis_by_date(analysis_date)
        if not all_data:
            return None

        companies_dict = all_data.get("companies", {})
        company_data = companies_dict.get(company)

        if not company_data:
            return None

        # 转换为旧格式以保持兼容性
        return {
            "company": company,
            "date": all_data.get("date"),
            "analyzed_at": all_data.get("analyzed_at"),
            "results": company_data.get("results", {})
        }

    def get_companies_for_date(self, target_date: Optional[date] = None, is_ai: bool = False) -> List[str]:
        """
        获取指定日期有数据的公司列表

        Args:
            target_date: 日期，默认为今天
            is_ai: 是否查询AI分析数据

        Returns:
            公司名称列表
        """
        if self.use_database and not is_ai:
            # 使用数据库模式（仅原始数据）
            return self.db.get_companies_for_date(target_date)

        # 使用 JSON 文件模式
        date_str = self._get_date_str(target_date)

        if is_ai:
            all_data = self.load_ai_analysis_by_date(target_date)
            if all_data:
                companies_dict = all_data.get("companies", {})
                return sorted(list(companies_dict.keys()))
        else:
            all_data = self.load_raw_data_by_date(target_date)
            if all_data:
                companies_dict = all_data.get("companies", {})
                return sorted(list(companies_dict.keys()))

        return []

    def get_all_dates_for_company(self, company: str, is_ai: bool = False) -> List[str]:
        """
        获取指定公司有数据的日期列表

        Args:
            company: 公司名称
            is_ai: 是否查询AI分析数据

        Returns:
            日期字符串列表（YYYY-MM-DD）
        """
        if self.use_database and not is_ai:
            # 使用数据库模式（仅原始数据）
            return self.db.get_all_dates_for_company(company)

        # 使用 JSON 文件模式
        base_dir = self.ai_analysis_dir if is_ai else self.raw_data_dir

        dates = []
        if os.path.exists(base_dir):
            for filename in os.listdir(base_dir):
                if filename.endswith(".json"):
                    # 提取日期：YYYY-MM-DD.json
                    date_part = filename[:-5]  # 移除.json
                    if len(date_part) == 10 and date_part.count("-") == 2:
                        # 检查该日期文件中是否包含该公司
                        try:
                            date_obj = date.fromisoformat(date_part)
                            if is_ai:
                                all_data = self.load_ai_analysis_by_date(date_obj)
                            else:
                                all_data = self.load_raw_data_by_date(date_obj)

                            if all_data:
                                companies_dict = all_data.get("companies", {})
                                if company in companies_dict:
                                    dates.append(date_part)
                        except Exception:
                            pass

        return sorted(dates, reverse=True)  # 最新日期在前

    def get_platform_video_ids(
        self,
        company: str,
        game: Optional[str],
        platform_type: str,
        url: str,
        fetch_date: Optional[date] = None
    ) -> set[str]:
        """
        获取指定平台在指定日期的所有视频ID（用于去重）

        Args:
            company: 公司名称
            game: 游戏名称（可选）
            platform_type: 平台类型
            url: 平台URL
            fetch_date: 日期，默认为今天

        Returns:
            video_id 集合
        """
        if self.use_database:
            # 使用数据库模式
            return self.db.get_platform_video_ids(company, game, platform_type, url, fetch_date)

        # 使用 JSON 文件模式
        all_data = self.load_raw_data_by_date(fetch_date)
        if not all_data:
            return set()

        companies_dict = all_data.get("companies", {})
        company_data = companies_dict.get(company)
        if not company_data:
            return set()

        platforms_dict = company_data.get("platforms", {})
        video_ids = set()

        # 遍历所有平台数据，查找匹配的平台
        for key, platform_data in platforms_dict.items():
            # 检查是否匹配（平台类型和URL）
            if (platform_data.get("platform_type", "").lower() == platform_type.lower() and
                platform_data.get("url", "") == url):
                posts = platform_data.get("posts", [])
                for post in posts:
                    # 提取 video_id（可能在不同字段中）
                    vid = post.get("video_id") or post.get("videoId")
                    if vid:
                        video_ids.add(vid)

        return video_ids


if __name__ == "__main__":
    # 简单测试
    db = CompetitorHistoryDB()

    # 测试保存原始数据
    test_data = [
        {
            "platform_type": "twitter",
            "game": None,
            "url": "https://x.com/test",
            "posts": [{"text": "test", "post_url": "https://x.com/test/1"}],
            "posts_count": 1,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }
    ]
    db.save_raw_data("Test Company", test_data)

    # 测试加载
    loaded = db.load_raw_data("Test Company")
    print(f"加载结果: {loaded is not None}")
