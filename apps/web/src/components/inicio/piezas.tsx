import { cn } from '@booster-ai/ui-components';
import type { ReactNode } from 'react';

export function StatChip({
  label,
  value,
  tono = 'neutral',
}: {
  label: string;
  value: string;
  tono?: 'neutral' | 'warning' | 'info';
}) {
  return (
    <div className="min-w-0 flex-1 px-2 py-1 text-center">
      <p className="text-neutral-500 text-xs">{label}</p>
      <p
        className={cn(
          'font-semibold text-2xl tabular-nums',
          tono === 'warning' && 'text-warning-700',
          tono === 'info' && 'text-primary-700',
          tono === 'neutral' && 'text-neutral-900',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function PlateTag({ plate }: { plate: string }) {
  return (
    <span className="rounded border border-neutral-300 px-1 font-medium font-mono text-neutral-800 text-xs">
      {plate}
    </span>
  );
}

export function StatusPill({
  children,
  tono = 'neutral',
}: {
  children: ReactNode;
  tono?: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-xs',
        tono === 'info' && 'bg-primary-50 text-primary-800',
        tono === 'warning' && 'bg-warning-50 text-warning-800',
        tono === 'success' && 'bg-success-50 text-success-800',
        tono === 'danger' && 'bg-danger-50 text-danger-700',
        tono === 'neutral' && 'bg-neutral-100 text-neutral-700',
      )}
    >
      {children}
    </span>
  );
}

export function RuleBadge({ children = 'regla pendiente' }: { children?: string }) {
  return (
    <span className="inline-flex rounded border border-primary-400 border-dashed bg-primary-50 px-1.5 py-0.5 font-semibold text-[10px] text-primary-800 uppercase tracking-wide">
      {children}
    </span>
  );
}

export function EmptyMoment({ children }: { children: string }) {
  return <p className="font-medium text-neutral-900 text-sm">{children}</p>;
}
