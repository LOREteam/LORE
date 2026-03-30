"use client";

import { useState, useEffect, memo } from "react";
import { pickRandom } from "../lib/loreTexts";

/**
 * Hydration-safe random lore text.
 * Renders items[0] on server/first paint, then picks random on client.
 */
export const LoreText = memo(function LoreText({ items }: { items: readonly string[] }) {
  const [text, setText] = useState(items[0]);

  useEffect(() => {
    setText(pickRandom(items));
  }, [items]);

  return <>{text}</>;
});
