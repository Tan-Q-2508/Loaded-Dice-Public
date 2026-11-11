import type { DecreeTile, DecreeType, GameEvent, GameState } from './types.js';
import { corrupt } from './state-helpers.js';

let tileCounter = 0;

export function resetTileCounter(): void {
  tileCounter = 0;
}

export function createTile(type: DecreeType): DecreeTile {
  tileCounter += 1;
  return { id: `tile-${tileCounter}`, type };
}

export function buildDeck(adharmaCount: number, dharmaCount = 6): DecreeTile[] {
  const tiles: DecreeTile[] = [];
  for (let i = 0; i < adharmaCount; i += 1) tiles.push(createTile('ADHARMA'));
  for (let i = 0; i < dharmaCount; i += 1) tiles.push(createTile('DHARMA'));
  return tiles;
}

/** Tiles drawn/held in the current legislation phase (not yet in deck, ash, or enacted). */
export function tilesInHand(state: GameState): readonly DecreeTile[] {
  if (state.phase.kind === 'LEGISLATION_MAHARAJ') return state.phase.drawnTiles;
  if (state.phase.kind === 'LEGISLATION_SENAPATI') return state.phase.heldTiles;
  return [];
}

export function totalTiles(state: GameState): number {
  return (
    state.decreeDeck.length +
    state.ashPile.length +
    state.enactedDharma +
    state.enactedAdharma +
    tilesInHand(state).length
  );
}

export function assertDeckIntegrity(
  state: GameState,
): { ok: true } | { ok: false; reason: string } {
  if (state.decreeDeck.length < 0 || state.ashPile.length < 0) {
    return { ok: false, reason: 'Negative deck or ash pile size' };
  }
  const total = totalTiles(state);
  if (total !== state.expectedTileCount) {
    return {
      ok: false,
      reason: `Tile count mismatch: expected ${state.expectedTileCount}, got ${total}`,
    };
  }
  const ids = new Set<string>();
  const all = [...state.decreeDeck, ...state.ashPile, ...tilesInHand(state)];
  for (const tile of all) {
    if (ids.has(tile.id)) {
      return { ok: false, reason: `Duplicate tile id ${tile.id}` };
    }
    if (tile.type !== 'DHARMA' && tile.type !== 'ADHARMA') {
      return { ok: false, reason: `Unknown tile type for ${tile.id}` };
    }
    ids.add(tile.id);
  }
  return { ok: true };
}

/**
 * When the Decree Deck is below `required`, shuffle the Ash Pile and place it
 * *under* the remaining facedown tiles. Remaining top cards keep their order
 * (Secret Hitler / spec §5.6 — never mix leftover draw tiles into the shuffle).
 */
export function reshuffleIfNeeded(
  state: GameState,
  required: number,
  rngShuffle: (tiles: readonly DecreeTile[]) => DecreeTile[],
): { state: GameState; events: GameEvent[]; reshuffled: boolean } {
  if (state.decreeDeck.length >= required) {
    return { state, events: [], reshuffled: false };
  }
  if (state.ashPile.length === 0) {
    return { state, events: [], reshuffled: false };
  }
  const preserved = [...state.decreeDeck];
  const under = rngShuffle([...state.ashPile]);
  const combined = [...preserved, ...under];
  const check = {
    ...state,
    decreeDeck: combined,
    ashPile: [] as DecreeTile[],
  };
  const integrity = assertDeckIntegrity(check);
  if (!integrity.ok && preserved.length + under.length < required) {
    return { state, events: [], reshuffled: false };
  }
  // #region agent log
  fetch('http://127.0.0.1:7361/ingest/3fd40a7f-41cf-45a6-ac18-e83e0fd4bfa6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fd802b'},body:JSON.stringify({sessionId:'fd802b',hypothesisId:'H5',location:'deck.ts:reshuffleIfNeeded',message:'reshuffle placed ash under preserved draw tiles',data:{required,preservedCount:preserved.length,ashCount:under.length,preservedIds:preserved.map((t)=>t.id),combinedCount:combined.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return {
    state: { ...state, decreeDeck: combined, ashPile: [] },
    events: [{ type: 'DECK_RESHUFFLED' }],
    reshuffled: true,
  };
}

export function drawTiles(
  state: GameState,
  count: number,
  rngShuffle: (tiles: readonly DecreeTile[]) => DecreeTile[],
): { state: GameState; drawn: DecreeTile[]; events: GameEvent[] } | { error: string } {
  let current = state;
  const events: GameEvent[] = [];
  const reshuffle = reshuffleIfNeeded(current, count, rngShuffle);
  current = reshuffle.state;
  events.push(...reshuffle.events);

  if (current.decreeDeck.length < count) {
    const totalAvailable = current.decreeDeck.length + current.ashPile.length;
    if (totalAvailable < count) {
      return { error: 'Insufficient tiles in deck and ash pile combined' };
    }
    const again = reshuffleIfNeeded(current, count, rngShuffle);
    current = again.state;
    events.push(...again.events);
  }

  if (current.decreeDeck.length < count) {
    return { error: 'Insufficient tiles after reshuffle' };
  }

  const drawn = current.decreeDeck.slice(0, count);
  const remaining = current.decreeDeck.slice(count);
  current = { ...current, decreeDeck: remaining };
  // As soon as fewer than 3 tiles remain, put shuffled Ash under them so
  // the next peek/draw (Akashvani or Maharaj) still sees a full 3.
  const topUp = reshuffleIfNeeded(current, 3, rngShuffle);
  current = topUp.state;
  events.push(...topUp.events);
  return {
    state: current,
    drawn,
    events,
  };
}

export function checkDeckOrCorrupt(
  state: GameState,
): { state: GameState; events: GameEvent[] } | null {
  const integrity = assertDeckIntegrity(state);
  if (!integrity.ok) {
    return corrupt(state, integrity.reason);
  }
  return null;
}
