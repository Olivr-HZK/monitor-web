from __future__ import annotations

from ai_tools import _parse_duckduckgo_html_results


def test_parse_duckduckgo_html_results_extracts_search_rows():
    html = """
    <html><body>
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fgameplay&amp;rut=abc">
          贪吃小绵羊玩法介绍
        </a>
        <a class="result__snippet">点击小羊吃蔬菜完成消除，先处理无遮挡小羊。</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://mp.weixin.qq.com/s/demo">
          公众号文章：小游戏攻略
        </a>
        <a class="result__snippet">核心玩法与爽点拆解。</a>
      </div>
    </body></html>
    """

    results = _parse_duckduckgo_html_results(html, 5)

    assert results == [
        {
            "sourceId": 1,
            "title": "贪吃小绵羊玩法介绍",
            "url": "https://example.com/gameplay",
            "content": "点击小羊吃蔬菜完成消除，先处理无遮挡小羊。",
        },
        {
            "sourceId": 2,
            "title": "公众号文章：小游戏攻略",
            "url": "https://mp.weixin.qq.com/s/demo",
            "content": "核心玩法与爽点拆解。",
        },
    ]
