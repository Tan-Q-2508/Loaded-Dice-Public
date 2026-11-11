import type { ReactNode } from 'react';

/**
 * Centered court modal — action prompts and announcements sit in the
 * middle of the viewport, sized to the content (no bottom-dock clip).
 */
export function CourtOverlay({
  children,
  testId = 'table-action-prompt',
  label = 'Your action',
}: {
  readonly children: ReactNode;
  readonly testId?: string;
  readonly label?: string;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-3 sm:p-5"
      data-testid={testId}
      aria-label={label}
    >
      <div
        className="absolute inset-0 bg-ink-950/55 backdrop-blur-[1px]"
        aria-hidden
      />
      <div className="relative max-h-[min(88dvh,40rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-brass-500/40 bg-ink-950/96 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.55)] sm:p-5">
        {children}
      </div>
    </div>
  );
}

export function AnnouncementBlock({
  title,
  body,
  testId,
  headingId,
}: {
  readonly title: string;
  readonly body: string;
  readonly testId?: string;
  readonly headingId?: string;
}) {
  return (
    <div className="text-center" data-testid={testId ?? 'court-announcement'}>
      <p className="font-body text-xs font-semibold uppercase tracking-[0.28em] text-brass-400">
        Court announcement
      </p>
      <h2
        id={headingId}
        className="mt-2 font-display text-xl text-mist-100 sm:text-2xl"
      >
        {title}
      </h2>
      <p className="mt-2 font-body text-sm leading-relaxed text-mist-200 sm:text-base">
        {body}
      </p>
    </div>
  );
}
