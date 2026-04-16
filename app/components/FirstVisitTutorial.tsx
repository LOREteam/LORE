"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { TabId } from "../lib/types";
import { UiButton } from "./ui/UiButton";
import { UiPanel } from "./ui/UiPanel";

const FIRST_VISIT_TUTORIAL_KEY = "lore:first-visit-tutorial:v1";

type TutorialStep = {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  tab?: TabId;
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    eyebrow: "Welcome",
    title: "How one round works",
    body: "Each epoch ends with one winning tile. Choose your tiles before the timer reaches zero, wait for reveal, then bets on the winning tile split the reward pool.",
    bullets: [
      "The header timer shows how much time is left in the current epoch.",
      "Hot Tiles shows which tiles won most often across the last 40 resolved rounds.",
      "If you win, the result appears in the Recent Wins ticker, Analytics, and the Rewards panel where you can claim it.",
    ],
    tab: "hub",
  },
  {
    eyebrow: "Mining Hub",
    title: "Start with manual betting",
    body: "The Hub is the main game screen. Select one or more tiles, set the amount per tile, and send the bet before reveal starts.",
    bullets: [
      "The total equals your amount per tile multiplied by the number of selected tiles.",
      "Repeat Bet restores your last tile selection and bet amount.",
      "The header shows the live epoch, countdown, pool, and wallet balances.",
    ],
    tab: "hub",
  },
  {
    eyebrow: "Automation",
    title: "Auto-Miner plays multiple rounds for you",
    body: "Auto-Miner repeats bets for multiple rounds using the settings in its panel.",
    bullets: [
      "Bet Size is the amount placed on each tile.",
      "Targets is how many random tiles Auto-Miner selects in each round.",
      "Cycles is how many rounds it will try to play before stopping.",
    ],
    tab: "hub",
  },
  {
    eyebrow: "Settings",
    title: "Wallet settings are your control center",
    body: "Open Wallet Settings from the header wallet card whenever you need to manage the embedded Privy wallet or the app's wallet tools.",
    bullets: [
      "Privy lets you create the embedded wallet, copy its address, export the private key, and deposit ETH or LINEA into it.",
      "Transfer is for withdrawing ETH or LINEA and reviewing transfer history.",
      "General, 7702, and Scan cover sound settings, reduced motion, diagnostics, pending-transaction tools, and deep reward scans.",
    ],
    tab: "hub",
  },
  {
    eyebrow: "Analytics",
    title: "Track your activity and progress",
    body: "Analytics shows what happened in your own betting history and in recent on-chain rounds.",
    bullets: [
      "Achievements tracks milestones unlocked from your deposit history.",
      "My Deposits shows your bets, outcomes, and wallet activity.",
      "Blockchain History and Jackpot History show recent resolved rounds and jackpot events.",
    ],
    tab: "analytics",
  },
  {
    eyebrow: "Rewards",
    title: "Rebate and Leaderboards cover the meta game",
    body: "Beyond direct wins, the app also tracks participation rebates and on-chain rankings.",
    bullets: [
      "Rebate shows your pending LINEA rebate and the epochs you can claim right now.",
      "Leaderboards rank biggest wins, ROI, most wins, whales, and the most successful tile.",
      "These tabs are most useful once you have played enough rounds to build history.",
    ],
    tab: "rebate",
  },
  {
    eyebrow: "Reference",
    title: "White Paper and FAQ explain the rest",
    body: "White Paper and FAQ cover the rules, wallet flow, jackpots, and common troubleshooting questions.",
    bullets: [
      "White Paper explains round flow, fee split, jackpots, Auto-Miner, rebates, and the wallet model.",
      "FAQ answers practical questions about gas, approvals, failed bets, claims, and wallet recovery.",
      "You can skip this tutorial now and reopen those docs later from the sidebar.",
    ],
    tab: "faq",
  },
];

interface FirstVisitTutorialProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function FirstVisitTutorial({ activeTab, onTabChange }: FirstVisitTutorialProps) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    try {
      const automationBrowser =
        typeof navigator !== "undefined"
        && (navigator.webdriver || /Headless/i.test(navigator.userAgent));
      if (automationBrowser) {
        window.localStorage.setItem(FIRST_VISIT_TUTORIAL_KEY, "1");
        setVisible(false);
        return;
      }
      const dismissed = window.localStorage.getItem(FIRST_VISIT_TUTORIAL_KEY);
      if (!dismissed) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const currentStep = TUTORIAL_STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    if (!visible) return;
    if (!currentStep?.tab) return;
    if (activeTab === currentStep.tab) return;
    onTabChange(currentStep.tab);
  }, [activeTab, currentStep, onTabChange, visible]);

  const progressPct = useMemo(
    () => ((stepIndex + 1) / TUTORIAL_STEPS.length) * 100,
    [stepIndex],
  );

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(FIRST_VISIT_TUTORIAL_KEY, "1");
    } catch {
      // ignore private mode / quota errors
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm md:items-center md:p-6">
      <UiPanel
        tone="default"
        padding="md"
        className="w-full max-w-2xl border-violet-400/20 bg-[#090914]/96 shadow-[0_24px_80px_rgba(2,6,23,0.6)]"
        role="dialog"
        aria-modal="true"
        aria-label="First visit tutorial"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/80">
              {currentStep.eyebrow}
            </div>
            <h2 className="text-xl font-black text-white md:text-2xl">{currentStep.title}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300 md:text-[15px]">
              {currentStep.body}
            </p>
          </div>

          <UiButton variant="ghost" size="xs" uppercase onClick={dismiss} className="shrink-0">
            Skip
          </UiButton>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
            <span>Step {stepIndex + 1} / {TUTORIAL_STEPS.length}</span>
            <span>{activeTab}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-400 transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {currentStep.bullets.map((bullet) => (
            <div
              key={bullet}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-sm leading-relaxed text-slate-300"
            >
              {bullet}
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <UiButton
            variant="ghost"
            size="sm"
            uppercase
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={isFirstStep}
          >
            Back
          </UiButton>

          <div className="flex items-center gap-2">
            {currentStep.tab && activeTab !== currentStep.tab && (
              <UiButton
                variant="secondary"
                size="sm"
                uppercase
                onClick={() => onTabChange(currentStep.tab as TabId)}
              >
                Open {currentStep.tab}
              </UiButton>
            )}

            <UiButton
              variant={isLastStep ? "success" : "primary"}
              size="sm"
              uppercase
              onClick={() => {
                if (isLastStep) {
                  dismiss();
                  return;
                }
                setStepIndex((current) => Math.min(TUTORIAL_STEPS.length - 1, current + 1));
              }}
            >
              {isLastStep ? "Finish" : "Next"}
            </UiButton>
          </div>
        </div>
      </UiPanel>
    </div>
  );
}
