"use client";

import type { InputHTMLAttributes } from "react";

import { EyeIcon, EyeOffIcon } from "~/app/_components/icons";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  visible: boolean;
  onToggleVisibility: () => void;
};

export function PasswordInput({
  visible,
  onToggleVisibility,
  className,
  ...props
}: PasswordInputProps) {
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${className ?? ""} pr-10`}
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        className="text-ink-muted hover:text-ink-primary absolute inset-y-0 right-0 flex w-10 items-center justify-center transition"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
