declare module 'lucide-react' {
  import type { FC, SVGProps } from 'react';
  export type LucideProps = SVGProps<SVGSVGElement> & {
    size?: string | number;
    color?: string;
    strokeWidth?: string | number;
  };
  export type LucideIcon = FC<LucideProps>;

  export const AlertTriangle: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowRightLeft: LucideIcon;
  export const ArrowUp: LucideIcon;
  export const ArrowUpRight: LucideIcon;
  export const Bot: LucideIcon;
  export const Check: LucideIcon;
  export const CheckCheck: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const Cpu: LucideIcon;
  export const EllipsisVertical: LucideIcon;
  export const Eye: LucideIcon;
  export const EyeOff: LucideIcon;
  export const Hand: LucideIcon;
  export const Headset: LucideIcon;
  export const KeyRound: LucideIcon;
  export const Lock: LucideIcon;
  export const LogOut: LucideIcon;
  export const Mail: LucideIcon;
  export const MessageCircle: LucideIcon;
  export const MessageSquare: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const Search: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Sparkles: LucideIcon;
  export const UserRound: LucideIcon;
  export const Wrench: LucideIcon;
  export const X: LucideIcon;
}
