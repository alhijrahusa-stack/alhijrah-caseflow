import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold transition-[background,box-shadow,transform,border-color,opacity,color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0F] disabled:pointer-events-none disabled:opacity-40 active:scale-[0.975] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "primary-gradient text-white border border-white/10 shadow-[0_12px_34px_-14px_rgba(99,102,241,.85)] hover:shadow-[0_16px_42px_-16px_rgba(129,140,248,.9)] hover:brightness-110",
        secondary:
          "glass text-slate-100 border border-white/10 hover:border-accent-400/30 hover:bg-white/[0.08] hover:shadow-[0_12px_36px_-20px_rgba(99,102,241,.55)]",
        outline:
          "border border-white/10 bg-white/[0.02] text-slate-100 hover:bg-white/[0.06] hover:border-white/20",
        ghost: "text-slate-300 hover:bg-white/[0.055] hover:text-white",
        destructive:
          "record-gradient text-white shadow-[0_12px_34px_-14px_rgba(244,63,94,.75)] hover:brightness-110",
        subtle:
          "border border-indigo-400/15 bg-indigo-400/10 text-indigo-200 hover:border-indigo-300/25 hover:bg-indigo-400/15",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 rounded-xl px-3 text-[13px]",
        lg: "h-14 px-7 text-base",
        icon: "size-10 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
