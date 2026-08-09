"use client";

import { useModalStatus } from "@privy-io/react-auth";
import { useEffect } from "react";

interface PrivyModalStatusBridgeProps {
  onChange: (isOpen: boolean) => void;
}

export default function PrivyModalStatusBridge({ onChange }: PrivyModalStatusBridgeProps) {
  const { isOpen } = useModalStatus();

  useEffect(() => {
    onChange(isOpen);
  }, [isOpen, onChange]);

  return null;
}
