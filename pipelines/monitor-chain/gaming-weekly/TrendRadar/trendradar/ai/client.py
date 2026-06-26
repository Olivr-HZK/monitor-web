# coding=utf-8
"""
AI 客户端模块

基于 LiteLLM 的统一 AI 模型接口
支持 100+ AI 提供商（OpenAI、DeepSeek、Gemini、Claude、国内模型等）
"""

import os
from typing import Any, Dict, List

from litellm import completion


class AIClient:
    """统一的 AI 客户端（基于 LiteLLM）"""

    def __init__(self, config: Dict[str, Any]):
        """
        初始化 AI 客户端

        Args:
            config: AI 配置字典
                - MODEL: 模型标识（格式: provider/model_name）
                - API_KEY: API 密钥
                - API_BASE: API 基础 URL（可选）
                - TEMPERATURE: 采样温度
                - MAX_TOKENS: 最大生成 token 数
                - TIMEOUT: 请求超时时间（秒）
                - NUM_RETRIES: 重试次数（可选）
                - FALLBACK_MODELS: 备用模型列表（可选）
        """
        self.model = config.get("MODEL", "openrouter/qwen/qwen3.7-max")
        self.api_key = config.get("API_KEY") or os.environ.get("AI_API_KEY", "")
        self.api_base = config.get("API_BASE", "")
        self.temperature = config.get("TEMPERATURE", 1.0)
        self.max_tokens = config.get("MAX_TOKENS", 5000)
        self.timeout = config.get("TIMEOUT", 120)
        self.num_retries = config.get("NUM_RETRIES", 2)
        self.fallback_models = config.get("FALLBACK_MODELS", [])
        self.fallback_route = config.get("FALLBACK_ROUTE", {}) or {}

    def _build_params(
        self,
        messages: List[Dict[str, str]],
        route: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        params = {
            "model": route.get("model", self.model),
            "messages": messages,
            "temperature": kwargs.get("temperature", self.temperature),
            "timeout": kwargs.get("timeout", self.timeout),
            "num_retries": kwargs.get("num_retries", self.num_retries),
        }

        api_key = route.get("api_key", self.api_key)
        if api_key:
            params["api_key"] = api_key

        api_base = route.get("api_base", self.api_base)
        if api_base:
            params["api_base"] = api_base

        max_tokens = kwargs.get("max_tokens", self.max_tokens)
        if max_tokens and max_tokens > 0:
            params["max_tokens"] = max_tokens

        if not route.get("is_route_fallback") and self.fallback_models:
            params["fallbacks"] = self.fallback_models

        for key, value in kwargs.items():
            if key not in params:
                params[key] = value

        return params

    def chat(
        self,
        messages: List[Dict[str, str]],
        **kwargs
    ) -> str:
        """
        调用 AI 模型进行对话

        Args:
            messages: 消息列表，格式: [{"role": "system/user/assistant", "content": "..."}]
            **kwargs: 额外参数，会覆盖默认配置

        Returns:
            str: AI 响应内容

        Raises:
            Exception: API 调用失败时抛出异常
        """
        primary_route = {
            "model": self.model,
            "api_key": self.api_key,
            "api_base": self.api_base,
            "is_route_fallback": False,
        }

        routes = [primary_route]
        fallback_model = self.fallback_route.get("MODEL", "")
        fallback_api_key = self.fallback_route.get("API_KEY", "")
        fallback_api_base = self.fallback_route.get("API_BASE", "")
        if fallback_model and fallback_api_key:
            routes.append({
                "model": fallback_model,
                "api_key": fallback_api_key,
                "api_base": fallback_api_base,
                "is_route_fallback": True,
            })

        last_error = None
        response = None
        for index, route in enumerate(routes):
            params = self._build_params(messages, route, **kwargs)
            try:
                if index > 0:
                    print(f"[AI] 主接口失败，切换到备用接口: {route['model']}")
                response = completion(**params)
                break
            except Exception as exc:
                last_error = exc
                if index == len(routes) - 1:
                    raise
                print(f"[AI] 当前接口调用失败: {exc}")

        if response is None and last_error:
            raise last_error

        # 提取响应内容
        # 某些模型/提供商返回 list（内容块）而非 str，统一转为 str
        content = response.choices[0].message.content
        if isinstance(content, list):
            content = "\n".join(
                item.get("text", str(item)) if isinstance(item, dict) else str(item)
                for item in content
            )
        return content or ""

    def validate_config(self) -> tuple[bool, str]:
        """
        验证配置是否有效

        Returns:
            tuple: (是否有效, 错误信息)
        """
        if not self.model:
            return False, "未配置 AI 模型（model）"

        if not self.api_key:
            return False, "未配置 AI API Key，请在 config.yaml 或环境变量 AI_API_KEY 中设置"

        # 验证模型格式（应该包含 provider/model）
        if "/" not in self.model:
            return False, f"模型格式错误: {self.model}，应为 'provider/model' 格式（如 'openrouter/qwen/qwen3.7-max'）"

        return True, ""
