"""Chart rendering behavior tests."""
from __future__ import annotations


def test_render_chart_png_supports_inverted_rank_axis(monkeypatch) -> None:
    import sys
    import types

    import chart_image

    calls: list[str] = []

    class FakeAxis:
        def set_title(self, *args, **kwargs):
            pass

        def plot(self, *args, **kwargs):
            pass

        def bar(self, *args, **kwargs):
            pass

        def fill_between(self, *args, **kwargs):
            pass

        def invert_yaxis(self):
            calls.append("invert")

        def grid(self, *args, **kwargs):
            pass

        def legend(self, *args, **kwargs):
            pass

        def tick_params(self, *args, **kwargs):
            pass

    class FakeFigure:
        def tight_layout(self):
            pass

        def savefig(self, buf, *args, **kwargs):
            buf.write(b"\x89PNGfake")

    fake_matplotlib = types.ModuleType("matplotlib")
    fake_matplotlib.use = lambda backend: None
    fake_pyplot = types.ModuleType("matplotlib.pyplot")
    fake_pyplot.rcParams = {}
    fake_pyplot.subplots = lambda *args, **kwargs: (FakeFigure(), FakeAxis())
    fake_pyplot.close = lambda fig: None
    monkeypatch.setitem(sys.modules, "matplotlib", fake_matplotlib)
    monkeypatch.setitem(sys.modules, "matplotlib.pyplot", fake_pyplot)

    png = chart_image.render_chart_png(
        {
            "type": "line",
            "title": "排名趋势",
            "xKey": "date",
            "series": [{"key": "rank", "name": "排名"}],
            "data": [{"date": "2026-06-01", "rank": 3}, {"date": "2026-06-02", "rank": 1}],
            "invertYAxis": True,
        }
    )

    assert png == b"\x89PNGfake"
    assert calls == ["invert"]
