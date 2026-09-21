/**
 * The explore mode's own front door: which map is open, and everything it needs to draw one.
 *
 * Self-contained by design. App knows about this screen the way it knows about the archive —
 * one `Page`, one early return — and nothing else about the daily game is involved. What it
 * fetches it fetches itself, through the same cached loaders App uses, so opening a map never
 * waits on a board nobody asked for and playing today never pays for a map.
 *
 * Which map is open lives in the path, `explore/{id}`, so the back button works and a reload
 * comes back to the same one. The ids are local and mean nothing to anyone else — an atlas is
 * not shareable, deliberately, because a shared board's code indexes against a puzzle's
 * endpoints and declared board and an atlas has neither.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { explore as says } from '../i18n/messages/explore';
import { Atlases } from './Atlases';
import { AtlasBoard } from './AtlasBoard';
import type { Ways } from './Masthead';
import type { Playing } from './Boards';
import { loadAtlas, openAtlas, saveAtlas, type Atlas } from '../lib/atlas';
import { NOTHING, type Remembered } from '../lib/atlasLayout';
import {
  listAtlases,
  newAtlasId,
  readAtlas,
  removeAtlas,
  unpack,
  writeAtlas,
  type AtlasCard,
  type AtlasRecord,
} from '../lib/atlasStore';
import { loadMode, loadRegions, modeName, type ModeData, type RawManifest } from '../lib/data';
import { NOWHERE, type Regions } from '../lib/regions';

interface Props {
  manifest: RawManifest;
  /**
   * Which of the open game's boards the path names — `letters`, `phonemes` — or null for the
   * list of maps.
   *
   * **A game and not a map**, which is the whole shape of this mode's addressing: `letters` is
   * a board of the open game the way `letters-short` is a board of the daily one, and *which*
   * of your letters maps is in front of you is remembered rather than addressed. So the two
   * live in the switch beside the six daily boards, and the list is a page you go to rather
   * than a thing with boards under it.
   */
  open: string | null;
  ways: Ways;
  /** Put one of them in the path, or take it out and show the list. */
  onOpen: (mode: string | null) => void;
  /** Go and play something else, which from here means a daily board. See `Boards`. */
  onPlay: (wanted: Playing) => void;
}

export function Explore({ manifest, open, ways, onOpen, onPlay }: Props) {
  const intl = useIntl();
  const [cards, setCards] = useState<readonly AtlasCard[]>([]);
  const [record, setRecord] = useState<AtlasRecord | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [settled, setSettled] = useState<Remembered | null>(null);
  const [world, setWorld] = useState<{ mode: number; data: ModeData; regions: Regions } | null>(
    null,
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * Bumped whenever the maps themselves change, which the address cannot say.
   *
   * `explore/letters` names the letters map game and not a map, so making one, opening a
   * different one or deleting the one in front of you all leave the path exactly as it was —
   * and an effect keyed on the path alone then has no reason to look again. Making a map and
   * landing back on the form that made it was this.
   */
  const [stamp, setStamp] = useState(0);
  const again = useCallback(() => setStamp((n) => n + 1), []);

  const reload = useCallback(() => {
    void listAtlases().then(setCards);
  }, []);
  // Whenever the list is what is on screen, which is also every time a map is left: the card
  // for the one just played has to show what it came to.
  useEffect(() => {
    if (open === null) reload();
  }, [open, reload]);

  /**
   * Open whichever map the path names.
   *
   * Every await is a cache hit after the first, so switching between two maps of one game is
   * as quick as switching bands. The `alive` flag is the ordinary guard against a slow fetch
   * for a map the player has already navigated away from.
   */
  useEffect(() => {
    if (open === null) {
      setRecord(null);
      setAtlas(null);
      setSettled(null);
      return;
    }
    let alive = true;
    void (async () => {
      /*
        Which map of this game to open: **the one last played, and nothing else is remembered.**

        A map is not addressed, so there is no id in the path to resolve — what `letters` names
        is the letters map game, and coming back to it means coming back to where you were. So
        the answer is the first card of this game, `listAtlases` being ordered by when each was
        last opened. That order has to be *total*: it was a `YYYY-MM-DD`, and two maps opened on
        the same day tied, so making a second map today opened the first one instead. See
        `opened` in atlasStore.
      */
      const mine = (await listAtlases()).filter((card) => card.mode === open);
      const found = mine.length > 0 ? await readAtlas(mine[0]!.id) : null;
      if (!alive) return;
      if (!found) {
        // No map of this game yet. The list is where one is made, and it opens ready to make
        // one of *this* game — which is what was asked for.
        setRecord(null);
        setAtlas(null);
        setSettled(null);
        return;
      }
      const mode = manifest.modes.findIndex((one) => one.name === found.mode);
      const at = mode < 0 ? 0 : mode;
      const [data, regions] = await Promise.all([
        loadMode(at, manifest),
        loadRegions(at, manifest),
      ]);
      if (!alive) return;
      setWorld({ mode: at, data, regions });
      /*
        Opening one is playing it, so it becomes the one this game comes back to.

        **The stamped record is what goes down to the board, not the one off the store.** The
        board writes itself back on a pause — `{ ...record, save, layout, camera }` — so handing
        it the record as it was read would have it put the stale `opened` back a second later,
        and the map you had just opened would stop being the one this game came back to.
      */
      const held = { ...found, touched: new Date().toISOString().slice(0, 10), opened: Date.now() };
      void writeAtlas(held);
      setRecord(held);
      setAtlas(loadAtlas(found.save) ?? openAtlas(found.save?.start ?? ''));
      const kept = unpack(found.layout);
      setSettled(kept ? { offsets: kept.offsets, centres: kept.centres, radii: kept.radii } : null);
    })();
    return () => {
      alive = false;
    };
  }, [open, stamp, manifest, onOpen]);

  /**
   * Start one.
   *
   * The word is judged against the *map* rather than against the dictionary: a real word with
   * no moves out of it, or one in a clump too small to be worth exploring, is refused here
   * with a sentence about having nowhere to go — which is true, and is a better thing to be
   * told than that a word you know perfectly well is not a word.
   */
  const start = useCallback(
    (mode: number, typed: string) => {
      void (async () => {
        const [data, regions] = await Promise.all([
          loadMode(mode, manifest),
          loadRegions(mode, manifest),
        ]);
        const raw = typed.trim().toLowerCase();
        const token = data.lexicon.parse(raw).find((one) => regions.has(one));
        if (token === undefined) {
          setRefusal(intl.formatMessage(says.notOnTheMap, { word: raw }));
          return;
        }
        setRefusal(null);
        const today = new Date().toISOString().slice(0, 10);
        const made: AtlasRecord = {
          id: newAtlasId(),
          mode: modeName(mode, manifest),
          vocab: manifest.modes[mode]?.vocab ?? '',
          // Named after the word it began at, which is the one thing that will always be true
          // of it. Renaming is a click away for anyone who wants a better one.
          name: data.lexicon.label(token),
          made: today,
          touched: today,
          // Which makes it the map this game comes back to, ahead of anything else made today.
          opened: Date.now(),
          save: saveAtlas(openAtlas(token)),
          layout: null,
          camera: null,
        };
        await writeAtlas(made);
        reload();
        again();
        onOpen(made.mode);
      })();
    },
    [manifest, intl, reload, onOpen],
  );

  const remove = useCallback(
    (id: string) => {
      void removeAtlas(id).then(() => {
        reload();
        again();
      });
    },
    [reload, again],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      void readAtlas(id).then((found) => {
        if (!found) return;
        void writeAtlas({ ...found, name }).then(() => {
          reload();
          again();
        });
      });
    },
    [reload, again],
  );

  const ready = record !== null && atlas !== null && world !== null;
  const board = useMemo(
    () => (ready ? { record, atlas, world } : null),
    [ready, record, atlas, world],
  );

  if (board) {
    return (
      <AtlasBoard
        record={board.record}
        settled={settled ?? NOTHING}
        atlas={board.atlas}
        setAtlas={setAtlas}
        graph={board.world.data.graph}
        lexicon={board.world.data.lexicon}
        regions={board.world.regions ?? NOWHERE}
        bands={manifest.bands}
        games={manifest.modes}
        ways={ways}
        onPlay={onPlay}
        onMaps={() => onOpen(null)}
      />
    );
  }

  return (
    <Atlases
      manifest={manifest}
      cards={cards}
      // Ready to make one of whichever game was asked for, when that game has none yet.
      game={open}
      refusal={refusal}
      ways={ways}
      onOpen={(id) => {
        // Opening a particular map makes it the one its game comes back to, and the address
        // says the game rather than the map. See `open` above.
        void readAtlas(id).then((found) => {
          if (!found) return;
          void writeAtlas({
            ...found,
            touched: new Date().toISOString().slice(0, 10),
            opened: Date.now(),
          }).then(() => {
            again();
            onOpen(found.mode);
          });
        });
      }}
      onRemove={remove}
      onRename={rename}
      onStart={start}
    />
  );
}
