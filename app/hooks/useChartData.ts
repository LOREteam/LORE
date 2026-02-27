"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { CHART_HISTORY_LENGTH, CHART_UPDATE_INTERVAL_MS } from "../lib/constants";

/**
 * Manages real-time chart data for the total pool visualization.
 */
export function useChartData(realTotalStaked: number) {
  const [chartData, setChartData] = useState<number[]>(Array(CHART_HISTORY_LENGTH).fill(0));
  const seededRef = useRef(false);
  const realTotalStakedRef = useRef(realTotalStaked);
  
  // Keep the ref updated with latest value
  useEffect(() => {
    realTotalStakedRef.current = realTotalStaked;
  }, [realTotalStaked]);

  // Seed chart with the first non-zero value (runs only once)
  useEffect(() => {
    if (!seededRef.current && realTotalStaked > 0) {
      seededRef.current = true;
      setChartData(Array(CHART_HISTORY_LENGTH).fill(realTotalStaked));
    }
  }, [realTotalStaked]);

  // Push new data points at regular intervals - interval never restarts
  useEffect(() => {
    const interval = setInterval(() => {
      setChartData((prev) => [...prev.slice(1), realTotalStakedRef.current]);
    }, CHART_UPDATE_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, []); // Empty deps - interval runs forever with latest ref value

  const maxValue = useMemo(() => Math.max(...chartData, 1), [chartData]);

  const linePath = useMemo(() => {
    if (chartData.length < 2) return "";
    const w = 100, h = 100, p = 1;
    const topOffset = 50;
    const cw = w - p * 2;
    const ch = h - p * 2 - topOffset;

    const pts = chartData.map((v, i) => ({
      x: p + (i / (chartData.length - 1)) * cw,
      y: p + topOffset + ch - (v / maxValue) * ch,
    }));

    let path = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      path += ` C ${midX},${pts[i].y} ${midX},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`;
    }
    return path;
  }, [chartData, maxValue]);

  return { chartData, linePath };
}
