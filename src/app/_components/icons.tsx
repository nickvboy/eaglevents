type IconProps = {
  className?: string;
};

function cx(...classes: Array<string | null | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

const baseSvgProps = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const,
  focusable: "false" as const,
};

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M18 15l-6-6-6 6" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M12 19V6" />
      <path d="M6 12l6-6 6 6" />
    </svg>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg {...baseSvgProps} className={cx("h-4 w-4", className)}>
      <path d="M12 5v13" />
      <path d="M6 12l6 6 6-6" />
    </svg>
  );
}
