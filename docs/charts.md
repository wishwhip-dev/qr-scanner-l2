# Charts

`@/components/ui/chart` wraps Recharts and maps your series onto the project's theme. It is
already installed and already themed — do not add a charting library, and do not hand-roll an SVG
bar chart.

```tsx
"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = { spend: { label: "Spend", color: "var(--chart-1)" } } satisfies ChartConfig;

<ChartContainer config={config} className="h-[240px] w-full">
  <AreaChart data={data}>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="month" tickLine={false} axisLine={false} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Area dataKey="spend" stroke="var(--color-spend)" fill="var(--color-spend)"
          fillOpacity={0.2} isAnimationActive={false} />
  </AreaChart>
</ChartContainer>
```

Each key in `config` becomes a `--color-<key>` variable, so `color: "var(--chart-1)"` in the
config is what `stroke="var(--color-spend)"` resolves to. Five colours are themed, `--chart-1`
through `--chart-5`. Use them rather than hex values: they are the only chart colours that follow
the project's palette.

## `isAnimationActive={false}` on every series is not optional

Recharts animates a series in from zero on mount, and that animation does not complete in the
headless browser this project is verified with. The grid and the axes draw, the data does not, and
the chart is checked as an empty box — a verification failure on a chart that is perfectly correct
in a real browser.

Measured, not guessed. Set it on every `Area`, `Bar`, `Line`, `Pie` and `Radar` you render.

If you want the chart to animate for a real visitor, animate its *container* with Motion instead —
the entrance is what reads as motion anyway, and the series itself stays drawn from the first
frame.

## A chart needs a height

`ChartContainer` fills its parent, and a parent with no height collapses it to nothing. Give it an
explicit height (`h-[240px]`, `aspect-video`) or put it in a grid row that has one. A chart that
renders as a 0px box is the second most common way this goes wrong.

## Client component

Recharts measures the DOM, so anything rendering a chart needs `"use client"` at the top of the
file. A chart in a server component fails at build, not at runtime.
