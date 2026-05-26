import { useData } from '../context/DataContext';

/** 全站数据加载顶栏进度条（fixed，不挡点击） */
export function DataLoadProgressBar() {
  const { dataLoading, dataLoadProgress } = useData();

  if (!dataLoading) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200]"
      role="progressbar"
      aria-valuenow={dataLoadProgress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="数据加载进度"
    >
      <div className="h-1 w-full bg-line/80">
        <div
          className="h-full bg-ink transition-[width] duration-300 ease-out"
          style={{ width: `${dataLoadProgress}%` }}
        />
      </div>
      <div className="flex items-center justify-center gap-2 border-b border-line/60 bg-surface/95 px-3 py-1.5 text-xs text-muted backdrop-blur-sm">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-ink" />
        <span>
          正在加载监测数据… <span className="font-medium tabular-nums text-ink">{dataLoadProgress}%</span>
        </span>
      </div>
    </div>
  );
}
