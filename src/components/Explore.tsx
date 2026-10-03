/**
 * The open game's screen: the list of maps at `/explore`, or a map at `/explore/{game}`.
 *
 * The path names a game, not a map; the map shown is that game's most recently opened one.
 * Fetches its own data through the same cached loaders App uses.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { explore as says } from '../i18n/messages/explore';
import { Atlases } from './Atlases';
import { AtlasBoard } from './AtlasBoard';
import type { Ways } from './Masthead';
import type { Playing } from './Boards';
import { loadAtlas, openAtlas, saveAtlas, canStart, type Atlas } from '../lib/atlas';
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
import {
  dailyGames,
  loadMode,
  loadRegions,
  mapMode,
  type ModeData,
  type RawManifest,
} from '../lib/data';
import { NOWHERE, type Regions } from '../lib/regions';

interface Props {
  manifest: RawManifest;
  /** The game the path names (`letters`, `phonemes`), or null for the list of maps. */
  open: string | null;
  ways: Ways;
  onOpen: (mode: string | null) => void;
  /** Switch to a daily board. */
  onPlay: (wanted: Playing) => void;
}

/**
 * Memoised because App keeps re-rendering while a map is up: the daily board's simulation in
 * `useBoardLayout` still runs and sets state on every tick. Its props are stable across those
 * renders, so this skips them instead of redrawing the whole map.
 */
export const Explore = memo(function Explore({ manifest, open, ways, onOpen, onPlay }: Props) {
  const intl = useIntl();
  const [cards, setCards] = useState<readonly AtlasCard[]>([]);
  const [record, setRecord] = useState<AtlasRecord | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [settled, setSettled] = useState<Remembered | null>(null);
  const [world, setWorld] = useState<{ mode: number; data: ModeData; regions: Regions } | null>(
    null,
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  // The game a new map is started in: the one the path names, else the last one open.
  const [game, setGame] = useState(() => open ?? dailyGames(manifest)[0]?.name ?? '');
  useEffect(() => {
    if (open !== null) setGame(open);
  }, [open]);
  // Bumped when the stored maps change, since making, opening or removing one can leave the
  // path unchanged and the effect below has to run again.
  const [stamp, setStamp] = useState(0);
  const again = useCallback(() => setStamp((n) => n + 1), []);

  const reload = useCallback(() => {
    void listAtlases().then(setCards);
  }, []);
  useEffect(() => {
    if (open === null) reload();
  }, [open, reload]);

  useEffect(() => {
    if (open === null) {
      setRecord(null);
      setAtlas(null);
      setSettled(null);
      return;
    }
    let alive = true;
    void (async () => {
      // The game's most recently opened map: `listAtlases` sorts by `opened`.
      const mine = (await listAtlases()).filter((card) => card.mode === open);
      const found = mine.length > 0 ? await readAtlas(mine[0]!.id) : null;
      if (!alive) return;
      if (!found) {
        // No map of this game yet: show the list, with the form set to this game.
        setRecord(null);
        setAtlas(null);
        setSettled(null);
        return;
      }
      // A record names its game; the graph it is drawn on is `mapMode`'s answer.
      const at = mapMode(found.mode, manifest);
      const [data, regions] = await Promise.all([
        loadMode(at, manifest),
        loadRegions(at, manifest),
      ]);
      if (!alive) return;
      setWorld({ mode: at, data, regions });
      // The board saves by spreading the record it is given, so it must get the stamped one or
      // it would write the old `opened` back.
      const held = { ...found, touched: new Date().toISOString().slice(0, 10), opened: Date.now() };
      void writeAtlas(held);
      setRecord(held);
      setAtlas(loadAtlas(found.save) ?? openAtlas(found.save?.start ?? ''));
      setSettled(unpack(found.layout));
    })();
    return () => {
      alive = false;
    };
  }, [open, stamp, manifest, onOpen]);

  /** Start a map, from a word with something around it (`canStart`). */
  const start = useCallback(
    (game: string, typed: string) => {
      void (async () => {
        const mode = mapMode(game, manifest);
        const [data, regions] = await Promise.all([
          loadMode(mode, manifest),
          loadRegions(mode, manifest),
        ]);
        const raw = typed.trim().toLowerCase();
        // A word can parse into several possible tokens,
        // e.g. in phonemes mode, a word said multiple ways.
        // start from the first that can be started from.
        // `unknown` then means that none of the tokens are a valid starting point
        const token = data.lexicon.parse(raw).find((one) => canStart(data.graph, regions, one));
        if (token === undefined) {
          setRefusal(intl.formatMessage(says.notOnTheMap, { word: raw }));
          return;
        }
        setRefusal(null);
        const today = new Date().toISOString().slice(0, 10);
        const made: AtlasRecord = {
          id: newAtlasId(),
          mode: game,
          vocab: manifest.modes[mode]?.vocab ?? '',
          name: data.lexicon.label(token),
          made: today,
          touched: today,
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
      cards={cards}
      game={game}
      refusal={refusal}
      ways={ways}
      onOpen={(id) => {
        // Stamp it as most recently opened, then open its game.
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
});
