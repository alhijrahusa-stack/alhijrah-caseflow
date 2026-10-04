import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,filter] duration-150 ease-out active:scale-[0.98] touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-text disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "brand-gradient text-primary-fg shadow-glow hover:brightness-110",
        secondary: "border border-white/10 bg-white/[0.06] text-fg backdrop-blur hover:border-white/20 hover:bg-white/[0.1]",
        outline: "border border-white/15 bg-transparent text-fg hover:bg-white/[0.06]",
        ghost: "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
        destructive: "bg-danger-solid text-white hover:brightness-110",
        subtle: "border border-primary/40 bg-primary/15 text-primary-text hover:bg-primary/25",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 rounded-lg px-3 text-[13px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "size-11 rounded-full",
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
