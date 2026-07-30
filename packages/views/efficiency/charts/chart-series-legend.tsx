interface ChartSeriesLegendItem {
  key: string;
  name: string;
  color: string;
}

interface ChartSeriesLegendProps {
  items: ChartSeriesLegendItem[];
  hiddenKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export function ChartSeriesLegend({
  items,
  hiddenKeys,
  onToggle,
}: ChartSeriesLegendProps) {
  return (
    <div
      role="group"
      aria-label="图例"
      className="flex max-w-full items-center gap-3 overflow-x-auto px-1 pb-2"
    >
      {items.map((item) => {
        const visible = !hiddenKeys.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={visible}
            aria-label={`${visible ? "隐藏" : "显示"} ${item.name}`}
            title={item.name}
            onClick={() => onToggle(item.key)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm transition-opacity"
              style={{
                backgroundColor: item.color,
                opacity: visible ? 1 : 0.25,
              }}
            />
            <span className={visible ? "" : "line-through opacity-60"}>
              {item.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
