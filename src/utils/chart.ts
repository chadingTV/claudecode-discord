import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration } from "chart.js";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 400;
const DEFAULT_BG = "#2b2d31"; // Discord dark theme background

export interface ChartFileConfig {
  /** Chart.js configuration object */
  chart: ChartConfiguration;
  /** Image width in pixels (default: 800) */
  width?: number;
  /** Image height in pixels (default: 400) */
  height?: number;
  /** Background color (default: Discord dark theme) */
  backgroundColor?: string;
}

/**
 * Render a Chart.js configuration to a PNG buffer.
 */
export async function renderChart(config: ChartFileConfig): Promise<Buffer> {
  const width = config.width ?? DEFAULT_WIDTH;
  const height = config.height ?? DEFAULT_HEIGHT;
  const bg = config.backgroundColor ?? DEFAULT_BG;

  const canvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: bg,
  });

  return canvas.renderToBuffer(config.chart);
}
