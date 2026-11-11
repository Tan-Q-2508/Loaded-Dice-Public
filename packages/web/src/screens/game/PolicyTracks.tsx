import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import {
  adharmaEmptySlotArt,
  boardArt,
  dharmaEmptySlotArt,
} from '../../lib/board-art';
import {
  adharmaPowerTrack,
  type PowerTrackSlot,
} from '../../lib/power-track-display';
import { roleSetupFooter } from '../../lib/role-setup-copy';

const DHARMA_SLOTS = 5;
const ADHARMA_SLOTS = 6;

export function PolicyTracks({ view }: { readonly view: WirePlayerView }) {
  const powers = adharmaPowerTrack(view.startPlayerCount);
  const highlight = view.lastEnactedDecree;
  const highlightIndex =
    highlight === 'DHARMA'
      ? view.enactedDharma
      : highlight === 'ADHARMA'
        ? view.enactedAdharma
        : null;

  return (
    <section
      className="w-full min-h-0"
      aria-label="Decree tracks"
      data-testid="policy-tracks"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex shrink-0 justify-center gap-8">
          <Pile
            label="Draw"
            sublabel="Decree Deck"
            count={view.decreeDeckCount}
            testId="decree-deck"
            art={boardArt.pileDraw}
          />
          <Pile
            label="Discard"
            sublabel="Ash Pile"
            count={view.ashPileCount}
            testId="ash-pile"
            art={boardArt.pileDiscard}
            muted
          />
        </div>
        {/* Side-by-side on wide-but-short screens (e.g. desktop landscape)
            so the two boards never have to fight each other for vertical
            room; stacked only when there isn't enough width for both. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-1.5 lg:grid-cols-2 lg:gap-3">
          <DharmaBoard
            filled={view.enactedDharma}
            highlightSlot={highlight === 'DHARMA' ? highlightIndex : null}
            electionTracker={view.electionTracker}
          />
          <AdharmaBoard
            filled={view.enactedAdharma}
            highlightSlot={highlight === 'ADHARMA' ? highlightIndex : null}
            powerLabels={[...powers, null] as readonly PowerTrackSlot[]}
            vetoUnlocked={view.vetoUnlocked}
            startPlayerCount={view.startPlayerCount}
          />
        </div>
      </div>
    </section>
  );
}

function DharmaBoard({
  filled,
  highlightSlot,
  electionTracker,
  className,
}: {
  readonly filled: number;
  readonly highlightSlot: number | null;
  readonly electionTracker: number;
  readonly className?: string;
}) {
  return (
    <div
      className={`relative min-w-0 w-full rounded-xl border border-brass-500/35 bg-[#1a140e] px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(226,192,120,0.12)] sm:px-2 sm:py-2 ${className ?? ''}`}
      data-testid="dharma-track-board"
      style={{
        backgroundImage: `url(${boardArt.dharmaBoard})`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }}
    >
      <div className="relative mb-1.5 flex items-baseline justify-between gap-2 rounded-sm bg-ink-950/55 px-1.5 py-0.5 backdrop-blur-[2px]">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-dharma-400 sm:text-base">
          Dharma
        </h3>
        <span className="font-body text-xs text-mist-200">
          {filled}/{DHARMA_SLOTS}
        </span>
      </div>
      <ol className="relative grid grid-cols-5 gap-1 sm:gap-1.5">
        {Array.from({ length: DHARMA_SLOTS }, (_, i) => {
          const slot = i + 1;
          const isFilled = slot <= filled;
          const isNew = highlightSlot !== null && slot === highlightSlot && isFilled;
          return (
            <li key={slot} className="min-w-0">
              <SlotFace
                testId={`dharma-slot-${slot}`}
                filled={isFilled}
                isNew={isNew}
                emptyArt={dharmaEmptySlotArt(i)}
                filledArt={boardArt.decreeDharma}
                alt={isFilled ? 'Dharma Decree' : `Dharma slot ${slot}`}
              />
            </li>
          );
        })}
      </ol>
      <ElectionTrackerInline value={electionTracker} />
    </div>
  );
}

function AdharmaBoard({
  filled,
  highlightSlot,
  powerLabels,
  vetoUnlocked,
  startPlayerCount,
  className,
}: {
  readonly filled: number;
  readonly highlightSlot: number | null;
  readonly powerLabels: readonly PowerTrackSlot[];
  readonly vetoUnlocked: boolean;
  readonly startPlayerCount: number;
  readonly className?: string;
}) {
  return (
    <div
      className={`relative min-w-0 rounded-xl border border-adharma-500/40 bg-[#160c0a] px-1.5 py-1.5 shadow-[inset_0_1px_0_rgba(196,90,72,0.15)] sm:px-2 sm:py-2 ${className ?? ''}`}
      data-testid="adharma-track-board"
      style={{
        backgroundImage: `url(${boardArt.adharmaBoard})`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }}
    >
      <div className="relative mb-1.5 flex items-baseline justify-between gap-2 rounded-sm bg-ink-950/55 px-1.5 py-0.5 backdrop-blur-[2px]">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-adharma-400 sm:text-base">
          Adharma
        </h3>
        <span className="font-body text-xs text-mist-200">
          {filled}/{ADHARMA_SLOTS}
        </span>
      </div>

      <img
        src={boardArt.bannerDuryodhanaSenapati}
        alt="Kauravas win if Duryodhana is elected Senapati after 3 Adharma Decrees"
        className="relative mb-1 hidden h-auto w-full rounded-sm border border-adharma-400/30 lg:mb-2 lg:block"
        data-testid="duryodhana-senapati-win-cue"
      />

      <ol className="relative grid grid-cols-6 gap-1 sm:gap-1.5">
        {Array.from({ length: ADHARMA_SLOTS }, (_, i) => {
          const slot = i + 1;
          const isFilled = slot <= filled;
          const isNew = highlightSlot !== null && slot === highlightSlot && isFilled;
          const power = powerLabels[i] ?? null;
          return (
            <li key={slot} className="min-w-0">
              <SlotFace
                testId={`adharma-slot-${slot}`}
                filled={isFilled}
                isNew={isNew}
                power={power}
                emptyArt={adharmaEmptySlotArt(i, power)}
                filledArt={boardArt.decreeAdharma}
                alt={
                  isFilled
                    ? 'Adharma Decree'
                    : power
                      ? `${power} slot`
                      : `Adharma slot ${slot}`
                }
                showDiceMarker={vetoUnlocked && slot === 5 && isFilled}
              />
            </li>
          );
        })}
      </ol>

      <p
        className="relative mt-2 rounded-sm border-t border-adharma-500/30 bg-ink-950/50 pt-1.5 text-center font-body text-xs leading-snug text-mist-200 backdrop-blur-[2px]"
        data-testid="role-setup-footer"
      >
        {roleSetupFooter(startPlayerCount)}
      </p>
      <p
        className={`relative mt-1 flex items-center justify-center gap-1.5 text-center font-body text-xs ${
          vetoUnlocked ? 'text-brass-300' : 'text-mist-300'
        }`}
        data-testid="veto-status"
      >
        {vetoUnlocked ? (
          <img
            src={boardArt.powerShakuniDice}
            alt=""
            className="h-4 w-4"
            aria-hidden
          />
        ) : null}
        {vetoUnlocked ? "Shakuni's Dice unlocked" : "Shakuni's Dice locked"}
      </p>
    </div>
  );
}

function SlotFace({
  testId,
  filled,
  isNew,
  emptyArt,
  filledArt,
  alt,
  power,
  showDiceMarker,
}: {
  readonly testId: string;
  readonly filled: boolean;
  readonly isNew: boolean;
  readonly emptyArt: string;
  readonly filledArt: string;
  readonly alt: string;
  readonly power?: PowerTrackSlot;
  readonly showDiceMarker?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      data-filled={filled ? 'true' : 'false'}
      data-power={power ?? ''}
      className={[
        'relative aspect-[3/4] w-full max-h-[3.75rem] overflow-hidden rounded-[3px] sm:max-h-[4.5rem] lg:max-h-[5.5rem]',
        isNew ? 'animate-[tileLand_480ms_ease-out] ring-2 ring-brass-400' : '',
      ].join(' ')}
    >
      <img
        src={filled ? filledArt : emptyArt}
        alt={alt}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      {showDiceMarker ? (
        <img
          src={boardArt.powerShakuniDice}
          alt="Shakuni's Dice unlocked"
          data-testid="veto-board-marker"
          className="absolute bottom-0.5 left-1/2 h-4 w-4 -translate-x-1/2 drop-shadow"
        />
      ) : null}
    </div>
  );
}

function ElectionTrackerInline({ value }: { readonly value: number }) {
  const n = Math.min(3, Math.max(0, value));
  return (
    <div
      className="relative mt-2 flex flex-col items-center gap-1 rounded-sm border-t border-brass-500/25 bg-ink-950/45 pt-2 backdrop-blur-[2px]"
      data-testid="election-tracker"
      aria-label={`Election tracker ${n} of 3`}
    >
      <p className="font-body text-xs uppercase tracking-[0.18em] text-mist-200">
        Election tracker
      </p>
      <ol className="flex items-center gap-2">
        {Array.from({ length: 3 }, (_, i) => {
          const active = i < n;
          const isAnarchy = i === 2;
          return (
            <li key={i} className="flex flex-col items-center gap-0.5">
              <span
                data-testid={`tracker-mark-${i + 1}`}
                data-active={active ? 'true' : 'false'}
                className={[
                  'h-3 w-3 rounded-full border sm:h-3.5 sm:w-3.5',
                  active
                    ? 'border-clay-500 bg-clay-500'
                    : 'border-mist-300/40 bg-ink-950/80',
                ].join(' ')}
              />
              <span className="font-body text-xs uppercase tracking-wide text-mist-300">
                {isAnarchy ? 'Anarchy' : 'Fail'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Pile({
  label,
  sublabel,
  count,
  testId,
  art,
  muted,
  className,
}: {
  readonly label: string;
  readonly sublabel: string;
  readonly count: number;
  readonly testId: string;
  readonly art: string;
  readonly muted?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      className={`flex w-12 shrink-0 flex-col items-center justify-center gap-1 sm:w-14 md:w-[4.25rem] ${className ?? ''}`}
      data-testid={testId}
    >
      <span className="font-body text-xs font-bold uppercase tracking-[0.16em] text-mist-200">
        {label}
      </span>
      <div
        className={`relative aspect-[512/640] w-11 sm:w-14 ${muted ? 'opacity-85' : ''}`}
      >
        <img
          src={art}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
          aria-hidden
          draggable={false}
        />
        <span className="absolute inset-x-0 bottom-1 text-center font-display text-base text-mist-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-lg">
          {count}
        </span>
      </div>
      <span className="text-center font-body text-xs leading-tight text-mist-300">
        {sublabel}
      </span>
    </div>
  );
}
