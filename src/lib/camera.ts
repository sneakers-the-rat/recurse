/**
 * Where the plate is looked at from.
 *
 * The board used to *be* the viewport: the figure was squeezed into a box the shape
 * of the plate and every word clamped inside it, so a board with sixty words drew
 * them all smaller. That is backwards for a game played on a phone — a word's size
 * should be a fact about the answer, not about how much else there is beside it.
 *
 * So the figure has whatever size it needs and this is a camera onto it. The scale comes from
 * the *answer* — the whole of it, source to target, in shot — and the surrounding graph runs
 * off the edges and is reached by dragging and pinching.
 *
 * A camera is a point and a scale — `scale` being pixels per graph unit — and the
 * viewBox is derived from it and the plate's size in pixels, so the view always has
 * the plate's own aspect and nothing is ever letterboxed.
 *
 * Pure arithmetic, kept out of the components: this is the part with the sign errors
 * in it, and it is testable in node.
 */

export interface Camera {
  /** Centre of the view, in graph units. */
  cx: number;
  cy: number;
  /** Pixels per graph unit. */
  scale: number;
}

/** The plate's size on screen, in CSS pixels. */
export interface Plate {
  width: number;
  height: number;
}

export interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * How big a word is on screen, which is the thing the play view is actually *for*.
 *
 * Labels are set at this many graph units (GraphPlate's own font size), so a scale is a
 * word size, and `GENEROUS_SCALE` is that reading of it.
 */
const LABEL_UNITS = 12.5;

/**
 * The largest a word is worth drawing on its own.
 *
 * A short answer fits its spine at nearly twice the scale of a long one, which would draw
 * a par-3 board at 24px — as large as the header's own statement — and make the board's
 * apparent size a fact about par rather than about the board. Zooming by hand still goes to
 * MAX_SCALE: this bounds what the game chooses, not what the player may ask for.
 *
 * **There is no floor to match it, and that is the point.** There was one — fifteen pixels, on
 * the grounds that a board of words too small to read is not a board — and a bank that runs to
 * par 10 turned it into the opposite of what it was for. A par-7 spine is 664 units with its
 * margins and a phone's plate holds 517 of them at that scale, so the view opened *inside* the
 * answer with both of the puzzle's own words cut off the ends: the one thing the play view
 * exists to frame, hidden, on every long board in the bank. A board drawn small is a board;
 * a board whose subject is off screen is not, and the size of the words is the half of this a
 * pinch can fix.
 */
export const GENEROUS_SCALE = 18 / LABEL_UNITS;

/** Hard stops on zooming, so a gesture cannot lose the board entirely. */
export const MIN_SCALE = 0.22;
export const MAX_SCALE = 4;

/**
 * Air left around the spine when the answer is framed.
 *
 * Enough for a word's *label*, not just its mark: labels sit twenty-odd units above the
 * node they belong to and stand about twelve tall, so anything under about forty clips the
 * source's own name against the top of the plate. Fifty-two is that with a little to
 * spare, and every unit of it is a unit the words cannot have.
 */
const SPINE_MARGIN = 52;

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The viewBox for a camera: the plate's own shape, centred where it is looking. */
export function viewOf(camera: Camera, plate: Plate): View {
  const width = plate.width / camera.scale;
  const height = plate.height / camera.scale;
  return { x: camera.cx - width / 2, y: camera.cy - height / 2, width, height };
}

/**
 * The view a puzzle is played at: source, target and the route between them, filling
 * the plate.
 *
 * Fixed by the *spine*, never by how much else there is to draw, which is what makes the words
 * the same size on a bare board and a crowded one — and **both of its ends are always in
 * shot**, whatever that costs in word size. The two words the puzzle is about are the one
 * thing on the plate a player is entitled to be able to find; a long answer is drawn small
 * rather than framed from the middle. Everything else still runs off the edges and is reached
 * by dragging.
 */
export function playCamera(spineHeight: number, plate: Plate): Camera {
  const wanted = plate.height / (spineHeight + SPINE_MARGIN * 2);
  return { cx: 0, cy: spineHeight / 2, scale: clamp(wanted, MIN_SCALE, GENEROUS_SCALE) };
}

/**
 * The view a round opens on: the whole board, pulled back.
 *
 * Not simply "fit the figure": a compact board fits inside the playing view already, so
 * fitting it *zoomed in* and the opening closed on nothing. This is never nearer than
 * the playing view and always a little further out than it, so the close is a move you
 * can see on any board.
 */
export function openingCamera(box: Box, spineHeight: number, plate: Plate): Camera {
  const fit = fitCamera(box, plate);
  const play = playCamera(spineHeight, plate);
  return { ...fit, scale: Math.max(Math.min(fit.scale, play.scale) * 0.85, MIN_SCALE) };
}

/** The view that shows all of something, with a little air around it. */
export function fitCamera(box: Box, plate: Plate, margin = 30): Camera {
  const width = Math.max(box.maxX - box.minX + margin * 2, 1);
  const height = Math.max(box.maxY - box.minY + margin * 2, 1);
  const scale = clamp(Math.min(plate.width / width, plate.height / height), MIN_SCALE, MAX_SCALE);
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
}

/**
 * Zoom about a point on the plate, keeping whatever is under that point still.
 *
 * `at` is in pixels from the plate's top-left, which is what a wheel or a pinch
 * gives; anchoring on it is the difference between zooming and the board sliding out
 * from under the pointer.
 */
export function zoomAround(
  camera: Camera,
  plate: Plate,
  factor: number,
  at: { x: number; y: number },
): Camera {
  const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
  if (scale === camera.scale) return camera;
  // The graph point under the pointer, before and after: the centre moves by the
  // difference, so that point stays put.
  const view = viewOf(camera, plate);
  const graphX = view.x + at.x / camera.scale;
  const graphY = view.y + at.y / camera.scale;
  const after = viewOf({ ...camera, scale }, plate);
  return {
    scale,
    cx: camera.cx + (graphX - (after.x + at.x / scale)),
    cy: camera.cy + (graphY - (after.y + at.y / scale)),
  };
}

/** Drag the board by a distance in pixels. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, cx: camera.cx - dx / camera.scale, cy: camera.cy - dy / camera.scale };
}

/**
 * Keep the figure reachable.
 *
 * Not "keep the figure on screen": panning off to the side to follow a long detour is
 * the whole point. But the board must never be lost altogether, so the centre of the
 * view is held within the figure's own bounds plus a screen's worth of slack — far
 * enough to put any part of the graph in the middle of the plate, near enough that
 * there is always something in shot.
 */
export function clampCamera(camera: Camera, box: Box, plate: Plate): Camera {
  const view = viewOf(camera, plate);
  // A little under half a screen, so the outermost word is always *inside* the edge
  // rather than exactly on it — at exactly half, panning to the limit left the board
  // balanced on the border of being gone.
  const slackX = view.width * 0.45;
  const slackY = view.height * 0.45;
  return {
    ...camera,
    cx: clamp(camera.cx, box.minX - slackX, box.maxX + slackX),
    cy: clamp(camera.cy, box.minY - slackY, box.maxY + slackY),
  };
}

/** Somewhere between two cameras. `t` runs 0 to 1; scale moves geometrically. */
export function between(from: Camera, to: Camera, t: number): Camera {
  return {
    cx: from.cx + (to.cx - from.cx) * t,
    cy: from.cy + (to.cy - from.cy) * t,
    // Geometrically, because scale is a ratio: halfway between 1× and 4× is 2×, and
    // interpolating it arithmetically makes a zoom lurch at one end.
    scale: from.scale * Math.pow(to.scale / from.scale, t),
  };
}

/** Ease in and out, for the one camera move the game makes on its own. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
