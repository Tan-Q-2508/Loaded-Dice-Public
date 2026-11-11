import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SECTIONS = [
  { id: 'overview', label: 'The court' },
  { id: 'teams', label: 'Teams' },
  { id: 'victory', label: 'How to win' },
  { id: 'play', label: 'A round' },
  { id: 'tracks', label: 'Decree tracks' },
  { id: 'powers', label: 'Rajaagna' },
  { id: 'chaos', label: 'Anarchy & veto' },
  { id: 'glossary', label: 'Glossary' },
] as const;

export function HowToPlayGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="how-to-play"
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg border border-brass-500/40 bg-ink-950/40 px-5 py-2.5 font-body text-sm font-semibold text-brass-300 transition hover:border-brass-400 hover:bg-brass-500/10 hover:text-brass-300"
      >
        How to play
      </button>
      {open ? <HowToPlayDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HowToPlayDialog({ onClose }: { readonly onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const jump = (id: string) => {
    const el = bodyRef.current?.querySelector(`#guide-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 text-left sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close how to play"
        className="absolute inset-0 bg-ink-950/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="how-to-play-dialog"
        className="court-table relative flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.5rem] text-left shadow-table sm:max-h-[90vh] sm:rounded-[1.75rem]"
      >
        <header className="shrink-0 border-b border-brass-500/20 px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-body text-xs font-semibold uppercase tracking-[0.28em] text-brass-400">
                Court primer
              </p>
              <h2
                id={titleId}
                className="mt-1 font-display text-2xl font-bold text-mist-100 sm:text-3xl"
              >
                How to play Loaded Dice
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              data-testid="how-to-play-close"
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-lg border border-mist-300/20 px-3 py-1.5 font-body text-sm font-semibold text-mist-200 transition hover:border-mist-300/45 hover:text-mist-100"
            >
              Close
            </button>
          </div>
          <nav
            aria-label="Guide sections"
            className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1"
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className="min-h-11 shrink-0 rounded-full border border-brass-500/25 bg-ink-950/50 px-3 py-1 font-body text-xs font-semibold uppercase tracking-[0.12em] text-mist-300 transition hover:border-brass-400/50 hover:text-brass-300"
              >
                {s.label}
              </button>
            ))}
          </nav>
        </header>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-6 text-left sm:px-7"
        >
          <GuideBody />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GuideBody() {
  return (
    <div className="space-y-10 text-left font-body text-sm leading-relaxed text-mist-200 [&_ol]:list-outside [&_ol]:pl-5 [&_ul]:list-outside [&_ul]:pl-5">
      <Section id="overview" title="The court">
        <p>
          Loaded Dice is a social deduction game for <strong>5–10 players</strong>. Two hidden
          teams sit in the same court: the <strong>Pandavas</strong>, who want five Dharma
          Decrees enacted (or Duryodhana exiled), and the <strong>Kauravas</strong>, who want six
          Adharma Decrees enacted — or Duryodhana seated as Senapati after the third Adharma
          Decree is already on the board.
        </p>
        <p className="mt-3">
          Most of the table does not know who is who. Talk, accuse, and vote. The court elects a
          government each round; that government then enacts a decree. Trust carefully.
        </p>
        <ol className="mt-4 list-outside list-decimal space-y-2 pl-5 text-left text-mist-100">
          <li>Look at your private role. Do not show it.</li>
          <li>The Maharaj Candidate nominates a Senapati. Everyone votes Ha or Nahi.</li>
          <li>If the government passes, they legislate a decree in secret, then reveal it.</li>
          <li>Some Adharma Decrees grant the Maharaj a Rajaagna (royal command).</li>
          <li>Repeat until a team wins.</li>
        </ol>
      </Section>

      <Section id="teams" title="Teams, roles, and secret knowledge">
        <p>
          Every seat is one of three roles. Duryodhana is on the Kaurava team. Pandavas know
          nothing about anyone else at the start.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-brass-500/20">
          <table className="w-full min-w-[28rem] text-left text-xs sm:text-sm">
            <thead className="bg-ink-950/70 text-[11px] uppercase tracking-[0.14em] text-mist-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Players</th>
                <th className="px-3 py-2 font-semibold">Pandavas</th>
                <th className="px-3 py-2 font-semibold">Kauravas</th>
                <th className="px-3 py-2 font-semibold">Duryodhana</th>
                <th className="px-3 py-2 font-semibold">Does Duryodhana know the Kauravas?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brass-500/10">
              <RoleRow players="5" pandavas="3" kauravas="1" knows="Yes" />
              <RoleRow players="6" pandavas="4" kauravas="1" knows="Yes" />
              <RoleRow players="7" pandavas="4" kauravas="2" knows="No" />
              <RoleRow players="8" pandavas="5" kauravas="2" knows="No" />
              <RoleRow players="9" pandavas="5" kauravas="3" knows="No" />
              <RoleRow players="10" pandavas="6" kauravas="3" knows="No" />
            </tbody>
          </table>
        </div>
        <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-left">
          <li>
            <strong className="text-mist-100">Kauravas always know each other</strong> and always
            know who Duryodhana is, at every player count.
          </li>
          <li>
            At <strong className="text-mist-100">7 or more players</strong>, Duryodhana sees only
            their own role — not the other Kauravas.
          </li>
          <li>
            The host may optionally enable <strong className="text-mist-100">role rebalance</strong>{' '}
            in the lobby (off by default): 6 players start with 1 Adharma Decree already enacted;
            7-player games start with 10 Adharma tiles in the deck instead of 11; 9-player games
            start with 9 Adharma tiles instead of 11.
          </li>
        </ul>
      </Section>

      <Section id="victory" title="How to win">
        <div className="grid gap-3 sm:grid-cols-2">
          <WinCard
            title="Pandava victory"
            tone="dharma"
            items={[
              '5 Dharma Decrees are enacted, or',
              'Duryodhana is exiled by Vanvas — the game ends the instant the Maharaj chooses that target.',
            ]}
          />
          <WinCard
            title="Kaurava victory"
            tone="adharma"
            items={[
              '6 Adharma Decrees are enacted, or',
              'Duryodhana is elected Senapati after the 3rd Adharma Decree is already on the board.',
            ]}
          />
        </div>
        <ul className="mt-4 list-outside list-disc space-y-2 pl-5 text-left">
          <li>
            The Duryodhana-as-Senapati check runs when a government is{' '}
            <strong className="text-mist-100">confirmed by a majority Ha</strong>, not at
            nomination. A rejected vote never triggers it.
          </li>
          <li>
            Electing Duryodhana as <strong className="text-mist-100">Maharaj</strong> does not
            end the game — only Senapati, and only after three Adharma Decrees are already
            enacted.
          </li>
          <li>
            If a non-Duryodhana Kaurava is exiled, the game continues. The system never reveals
            that player’s team.
          </li>
        </ul>
      </Section>

      <Section id="play" title="A round of play">
        <h4 className="font-display text-lg text-mist-100">1. Nomination (Rajya Sabha)</h4>
        <p className="mt-2">
          The current Maharaj Candidate picks any eligible living player as Senapati Candidate.
        </p>
        <p className="mt-2">
          <strong className="text-mist-100">Rajya Maryada (term limits)</strong> — the most
          recently elected Maharaj and Senapati cannot be nominated as Senapati. Exception: if
          exactly 5 players remain alive, only the last elected Senapati is ineligible. Term
          limits never block becoming Maharaj Candidate through normal rotation.
        </p>

        <h4 className="mt-5 font-display text-lg text-mist-100">2. Election</h4>
        <p className="mt-2">
          Every living player votes <strong className="text-mist-100">Ha</strong> (yes) or{' '}
          <strong className="text-mist-100">Nahi</strong> (no) at the same time. Ballots stay
          hidden until all are in, then flip together.
        </p>
        <ul className="mt-2 list-outside list-disc space-y-2 pl-5 text-left">
          <li>
            <strong className="text-mist-100">Majority Ha</strong> (strictly more than half of
            living players) confirms the government. Then legislate.
          </li>
          <li>
            A tie or majority Nahi rejects it. The Election Tracker advances by 1, and the
            Maharaj placard moves to the next living player.
          </li>
        </ul>

        <h4 className="mt-5 font-display text-lg text-mist-100">3. Legislation (Shastra Sabha)</h4>
        <p className="mt-2">
          The Decree Deck starts with <strong className="text-mist-100">11 Adharma</strong> and{' '}
          <strong className="text-mist-100">6 Dharma</strong> tiles (17 total), shuffled. Discarded
          tiles go face-down to the Ash Pile and are never shown to the table.
        </p>
        <ol className="mt-2 list-outside list-decimal space-y-2 pl-5 text-left">
          <li>
            The Maharaj privately draws the top 3 tiles, discards 1 to the Ash Pile, and passes
            the remaining 2 to the Senapati.
          </li>
          <li>
            The Senapati privately discards 1 and enacts the last tile face-up on its track.
          </li>
        </ol>
        <p className="mt-2">
          If the deck has fewer than 3 tiles, the Ash Pile is shuffled and placed under the
          remaining facedown tiles (those leftover cards stay on top, in order). This also
          happens before Akashvani, so the Maharaj always peeks three decrees when tiles remain.
          After any enactment, check win conditions. If an Adharma Decree just filled a
          power slot, the Maharaj resolves that Rajaagna before the next nomination.
        </p>
      </Section>

      <Section id="tracks" title="Decree tracks and Rajaagna slots">
        <p>
          Dharma needs 5 enacted tiles to win. Adharma needs 6. Slots 1–5 on the Adharma track
          may grant a Rajaagna, depending on how many players started the game. Slot 6 is always
          a Kaurava win — no power.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-brass-500/20">
          <table className="w-full min-w-[32rem] text-left text-xs sm:text-sm">
            <thead className="bg-ink-950/70 text-[11px] uppercase tracking-[0.14em] text-mist-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Start count</th>
                <th className="px-3 py-2 font-semibold">1st</th>
                <th className="px-3 py-2 font-semibold">2nd</th>
                <th className="px-3 py-2 font-semibold">3rd</th>
                <th className="px-3 py-2 font-semibold">4th</th>
                <th className="px-3 py-2 font-semibold">5th</th>
                <th className="px-3 py-2 font-semibold">6th</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brass-500/10">
              <PowerRow
                band="5–6"
                slots={['—', '—', 'Akashvani', 'Vanvas', 'Vanvas', 'Kaurava win']}
              />
              <PowerRow
                band="7–8"
                slots={[
                  '—',
                  'Divya Drishti',
                  'Rajya Sabha Summons',
                  'Vanvas',
                  'Vanvas',
                  'Kaurava win',
                ]}
              />
              <PowerRow
                band="9–10"
                slots={[
                  'Divya Drishti',
                  'Divya Drishti',
                  'Rajya Sabha Summons',
                  'Vanvas',
                  'Vanvas',
                  'Kaurava win',
                ]}
              />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-mist-300">
          After the 3rd Adharma Decree, electing Duryodhana as Senapati wins for the Kauravas.
          After the 5th, Shakuni&apos;s Dice (veto) unlocks permanently.
        </p>
      </Section>

      <Section id="powers" title="Rajaagna — the four royal commands">
        <p>
          Powers trigger only when an Adharma Decree is enacted through a normal legislative
          session and that slot has a power. Anarchy-enacted decrees skip powers entirely. Each
          trigger is single-use.
        </p>
        <dl className="mt-4 space-y-4">
          <PowerDef
            name="Divya Drishti"
            gloss="Divine Sight — investigate loyalty"
            body="The Maharaj picks a living player and privately sees that player’s team: Pandava or Kaurava. Duryodhana appears as Kaurava — never named. The Maharaj may tell the truth or lie. Each player may be investigated at most once per game."
          />
          <PowerDef
            name="Rajya Sabha Summons"
            gloss="Special election"
            body="The Maharaj picks any other living player — including someone term-limited — to become the next Maharaj Candidate immediately, skipping normal rotation for that one round. After that special-election government resolves (pass or fail), the Maharaj placard returns to the player immediately after the Maharaj who called the summons, and rotation resumes from there."
          />
          <PowerDef
            name="Akashvani"
            gloss="Celestial Foresight — policy peek"
            body="The Maharaj privately views the top 3 tiles of the Decree Deck in their current order, without changing that order, then play continues to the next nomination."
          />
          <PowerDef
            name="Vanvas"
            gloss="Exile — execution"
            body="The Maharaj exiles a living player. That seat can no longer vote, be nominated, or act, but may stay as a spectator. If the target is Duryodhana, the Pandavas win immediately. Otherwise the table is not told the exiled player’s team."
          />
        </dl>
      </Section>

      <Section id="chaos" title="Kurukshetra Anarchy and Shakuni’s Dice">
        <h4 className="font-display text-lg text-mist-100">Kurukshetra Anarchy</h4>
        <p className="mt-2">
          Three consecutive failed governments fill the Election Tracker. Then, immediately:
        </p>
        <ol className="mt-2 list-outside list-decimal space-y-2 pl-5 text-left">
          <li>The top tile of the Decree Deck is enacted automatically (if the deck is empty, the shuffled Ash Pile is placed as the new deck first).</li>
          <li>Any Rajaagna that tile would grant is skipped — no executive action.</li>
          <li>The Election Tracker resets to 0.</li>
          <li>All Rajya Maryada (term-limit) restrictions are cleared.</li>
          <li>The Maharaj placard advances to the next living player and nomination resumes.</li>
        </ol>
        <p className="mt-2">
          Any decree enactment — legislative or anarchy — also resets the Election Tracker to 0.
        </p>

        <h4 className="mt-5 font-display text-lg text-mist-100">Shakuni&apos;s Dice (veto)</h4>
        <p className="mt-2">
          Unlocked permanently once the 5th Adharma Decree is enacted. From then on, after the
          Senapati receives two tiles, they may propose a veto instead of enacting. Both Maharaj
          and Senapati must agree. If they do, both tiles go to the Ash Pile with no decree
          enacted, and the Election Tracker advances by 1 — the same as a rejected government.
          If either disagrees, the Senapati must discard one tile and enact the other.
        </p>
      </Section>

      <Section id="glossary" title="Names at the table">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Term name="Maharaj" def="President for this government — draws three decrees, discards one." />
          <Term name="Senapati" def="Chancellor — receives two decrees and enacts one." />
          <Term name="Dharma Decree" def="Pandava policy tile. Five enacted wins for the Pandavas." />
          <Term name="Adharma Decree" def="Kaurava policy tile. Six enacted wins for the Kauravas." />
          <Term name="Decree Deck" def="The facedown draw pile." />
          <Term name="Ash Pile" def="Facedown discards. When the Decree Deck has fewer than 3 tiles, the Ash Pile is shuffled and placed under the remaining draw tiles." />
          <Term name="Rajya Sabha" def="The election: nominate, then vote Ha or Nahi." />
          <Term name="Shastra Sabha" def="The legislative session after a government passes." />
          <Term name="Rajaagna" def="A royal command granted by certain Adharma track slots." />
          <Term name="Rajya Maryada" def="Term limits on who may be nominated Senapati." />
          <Term name="Kurukshetra Anarchy" def="Three failed governments; the top decree enacts with no power." />
          <Term name="Shakuni’s Dice" def="Veto, unlocked after the fifth Adharma Decree." />
        </dl>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={`guide-${id}`} aria-labelledby={`guide-${id}-title`} className="scroll-mt-2">
      <h3
        id={`guide-${id}-title`}
        className="font-display text-xl font-bold text-brass-300 sm:text-2xl"
      >
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function RoleRow({
  players,
  pandavas,
  kauravas,
  knows,
}: {
  readonly players: string;
  readonly pandavas: string;
  readonly kauravas: string;
  readonly knows: string;
}) {
  return (
    <tr className="text-mist-100">
      <td className="px-3 py-2">{players}</td>
      <td className="px-3 py-2">{pandavas}</td>
      <td className="px-3 py-2">{kauravas}</td>
      <td className="px-3 py-2">1</td>
      <td className="px-3 py-2">{knows}</td>
    </tr>
  );
}

function PowerRow({
  band,
  slots,
}: {
  readonly band: string;
  readonly slots: readonly string[];
}) {
  return (
    <tr className="text-mist-100">
      <td className="px-3 py-2 font-semibold">{band}</td>
      {slots.map((slot, i) => (
        <td key={`${band}-${i}`} className="px-3 py-2">
          {slot}
        </td>
      ))}
    </tr>
  );
}

function WinCard({
  title,
  tone,
  items,
}: {
  readonly title: string;
  readonly tone: 'dharma' | 'adharma';
  readonly items: readonly string[];
}) {
  const border = tone === 'dharma' ? 'border-dharma-500/40' : 'border-adharma-500/40';
  const heading = tone === 'dharma' ? 'text-dharma-400' : 'text-adharma-400';
  return (
    <div className={`rounded-xl border ${border} bg-ink-950/50 px-4 py-3`}>
      <h4 className={`font-display text-base font-bold ${heading}`}>{title}</h4>
      <ul className="mt-2 list-outside list-disc space-y-1.5 pl-5 text-left text-mist-200">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PowerDef({
  name,
  gloss,
  body,
}: {
  readonly name: string;
  readonly gloss: string;
  readonly body: string;
}) {
  return (
    <div className="rounded-xl border border-brass-500/15 bg-ink-950/40 px-4 py-3">
      <dt className="font-display text-base text-mist-100">{name}</dt>
      <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-brass-400">{gloss}</p>
      <dd className="mt-2 text-mist-200">{body}</dd>
    </div>
  );
}

function Term({ name, def }: { readonly name: string; readonly def: string }) {
  return (
    <div className="rounded-lg border border-brass-500/10 bg-ink-950/30 px-3 py-2">
      <dt className="font-semibold text-mist-100">{name}</dt>
      <dd className="mt-0.5 text-mist-300">{def}</dd>
    </div>
  );
}
