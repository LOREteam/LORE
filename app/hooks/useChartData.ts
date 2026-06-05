"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { CHART_HISTORY_LENGTH, CHART_UPDATE_INTERVAL_MS } from "../lib/constants";

const MIN_VISIBLE_DELTA = 0.01;

function normalizePositiveValue(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function buildRoundHistory(currentValue: number) {
  const normalized = Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 0;
  if (normalized <= 0) return Array(CHART_HISTORY_LENGTH).fill(0);

  return Array.from({ length: CHART_HISTORY_LENGTH }, (_, index) => {
    const progress = index / Math.max(1, CHART_HISTORY_LENGTH - 1);
    return normalized * progress;
  });
}

function buildEmptyRoundHistory() {
  return Array(CHART_HISTORY_LENGTH).fill(0);
}

function normalizeHistory(values: number[], currentValue: number) {
  const sanitized = values.filter((value) => Number.isFinite(value) && value >= 0);
  const padded = sanitized.length > 0 ? sanitized.slice(-CHART_HISTORY_LENGTH) : buildRoundHistory(currentValue);

  while (padded.length < CHART_HISTORY_LENGTH) {
    padded.unshift(padded[0] ?? currentValue);
  }

  if (currentValue > 0) {
    padded[padded.length - 1] = currentValue;
  }

  return padded;
}

function isUsableHistory(values: number[]) {
  return values.length === CHART_HISTORY_LENGTH && values.every((value) => Number.isFinite(value) && value >= 0);
}

function pushHistoryPoint(values: number[], nextValue: number, forceAppend = false) {
  const normalizedNext = normalizePositiveValue(nextValue);
  const current = isUsableHistory(values) ? values : normalizeHistory(values, normalizedNext);
  const previousLast = current[current.length - 1] ?? 0;

  // During resolve, live tile data can briefly report zero before the next epoch
  // snapshot lands. Keep the current round trace instead of drawing a fake drop.
  if (normalizedNext <= 0 && current.some((value) => value > 0)) {
    return forceAppend ? [...current.slice(1), previousLast] : current;
  }

  if (normalizedNext > 0 && current.every((value) => value <= 0)) {
    return buildRoundHistory(normalizedNext);
  }

  if (!forceAppend && Math.abs(previousLast - normalizedNext) < MIN_VISIBLE_DELTA) {
    return current;
  }

  return [...current.slice(1), normalizedNext];
}

/**
 * Manages real-time chart data for the total pool visualization.
 */
export function useChartData(realTotalStaked: number, isPageVisible = true, epochKey: string | number | bigint | null = null) {
  const normalizedEpochKey = epochKey == null ? "unknown" : String(epochKey);
  const [chartData, setChartData] = useState<number[]>(() => buildRoundHistory(realTotalStaked));
  const epochKeyRef = useRef(normalizedEpochKey);
  const realTotalStakedRef = useRef(realTotalStaked);
  const lastPositiveTotalRef = useRef(normalizePositiveValue(realTotalStaked));
  
  // Keep the ref updated with latest value
  useEffect(() => {
    realTotalStakedRef.current = realTotalStaked;
    const normalizedTotal = normalizePositiveValue(realTotalStaked);
    if (normalizedTotal > 0) {
      lastPositiveTotalRef.current = normalizedTotal;
    }
  }, [realTotalStaked]);

  // The chart is scoped to the current round. A new epoch starts a fresh live trace.
  useEffect(() => {
    if (epochKeyRef.current === normalizedEpochKey) return;
    epochKeyRef.current = normalizedEpochKey;
    lastPositiveTotalRef.current = 0;
    setChartData(buildEmptyRoundHistory());
  }, [normalizedEpochKey]);

  // Add visible pool changes immediately so the graph reacts to bets/resolves without waiting for the interval.
  useEffect(() => {
    setChartData((prev) => {
      const next = pushHistoryPoint(prev, realTotalStaked);
      return next;
    });
  }, [realTotalStaked]);

  // Push new data points at regular intervals - interval never restarts
  useEffect(() => {
    if (!isPageVisible) return;
    const interval = setInterval(() => {
      setChartData((prev) => {
        const nextValue = normalizePositiveValue(realTotalStakedRef.current) > 0
          ? realTotalStakedRef.current
          : lastPositiveTotalRef.current;
        const next = pushHistoryPoint(prev, nextValue, true);
        if (next === prev) return prev;
        return next;
      });
    }, CHART_UPDATE_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [isPageVisible]);

  const effectiveChartData = useMemo(
    () => normalizeHistory(chartData, normalizePositiveValue(realTotalStaked) > 0 ? realTotalStaked : lastPositiveTotalRef.current),
    [chartData, realTotalStaked],
  );

  const linePath = useMemo(() => {
    if (effectiveChartData.length < 2) return "";

    const w = 100, h = 100, p = 0;
    const topOffset = 10;
    const bottomOffset = 14;
    const cw = w - p * 2;
    const ch = h - p * 2 - topOffset - bottomOffset;
    const maxValue = Math.max(...effectiveChartData);
    if (maxValue <= 0) return "";

    const minValue = Math.min(...effectiveChartData);
    const valueRange = maxValue - minValue;
    const lowY = p + topOffset + ch * 0.72;
    const highY = p + topOffset + ch * 0.18;
    const yRange = lowY - highY;

    const pointCount = effectiveChartData.length;
    if (valueRange < MIN_VISIBLE_DELTA) {
      const y = p + topOffset + ch * 0.42;
      const lift = 1.6;
      return `M 0,${y} C 18,${y} 18,${y - lift} 36,${y - lift} C 54,${y - lift} 54,${y - lift * 0.55} 72,${y - lift * 0.55} C 86,${y - lift * 0.55} 86,${y - lift} 100,${y - lift}`;
    }

    const yForValue = (value: number) => lowY - (Math.max(0, value) / maxValue) * yRange;
    const xForIndex = (index: number) => p + (index / (pointCount - 1)) * cw;

    let prevX = xForIndex(0);
    let prevY = yForValue(effectiveChartData[0]);
    let path = `M ${prevX},${prevY}`;
    for (let i = 1; i < pointCount; i++) {
      const x = xForIndex(i);
      const y = yForValue(effectiveChartData[i]);
      const midX = (prevX + x) / 2;
      path += ` C ${midX},${prevY} ${midX},${y} ${x},${y}`;
      prevX = x;
      prevY = y;
    }
    return path;
  }, [effectiveChartData]);

  return { chartData, linePath };
}
