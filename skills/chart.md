Generate a chart and send it to Discord by writing a `.chart.json` file in the current working directory.

## Instructions

1. Prepare the data for the chart based on the user's request
2. Write a file named `<descriptive-name>.chart.json` to the current working directory (NOT a subdirectory)
3. The file must contain a JSON object with this structure:

```json
{
  "chart": {
    "type": "line",
    "data": {
      "labels": ["Label1", "Label2", "Label3"],
      "datasets": [{
        "label": "Dataset Name",
        "data": [10, 20, 30],
        "borderColor": "#5865F2",
        "backgroundColor": "rgba(88, 101, 242, 0.1)"
      }]
    },
    "options": {}
  },
  "width": 800,
  "height": 400,
  "backgroundColor": "#2b2d31"
}
```

## Supported chart types

- `line` — time series, trends, price history
- `bar` — comparisons, volumes, categorical data
- `pie` / `doughnut` — proportions, allocations
- `radar` — multi-dimensional comparisons
- `scatter` — correlations, distributions
- `bubble` — 3-variable relationships

## Style guidelines for Discord

- Use Discord dark theme background: `#2b2d31` (default)
- Use bright, high-contrast colors for data: `#5865F2` (blurple), `#57F287` (green), `#FEE75C` (yellow), `#ED4245` (red), `#EB459E` (pink)
- Set `color: '#dcddde'` on axis ticks and legend labels for readability
- Default size 800x400 is good for most charts; use 800x600 for complex ones
- Include a descriptive title via `options.plugins.title`

## Example: financial line chart

```json
{
  "chart": {
    "type": "line",
    "data": {
      "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
      "datasets": [{
        "label": "AAPL",
        "data": [189.5, 191.2, 190.8, 193.1, 195.0],
        "borderColor": "#5865F2",
        "backgroundColor": "rgba(88, 101, 242, 0.1)",
        "fill": true,
        "tension": 0.3
      }]
    },
    "options": {
      "plugins": {
        "title": { "display": true, "text": "AAPL Weekly Price", "color": "#dcddde" },
        "legend": { "labels": { "color": "#dcddde" } }
      },
      "scales": {
        "x": { "ticks": { "color": "#dcddde" }, "grid": { "color": "#40444b" } },
        "y": { "ticks": { "color": "#dcddde" }, "grid": { "color": "#40444b" } }
      }
    }
  }
}
```

## Important

- The `.chart.json` file is auto-approved (no user button click needed) and automatically deleted after rendering
- The bot renders it to PNG and posts the image to Discord
- You can write multiple `.chart.json` files in one turn for multiple charts
- Use the Chart.js v4 configuration format
- If you have access to financial data MCP tools, fetch real data first, then generate the chart
