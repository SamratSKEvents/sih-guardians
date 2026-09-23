/**
 * Preview of the selected slick: what it is, when, how large, and how far to
 * trust it. Wording follows the brief: a SAR dark feature is a *possible* oil
 * slick, and a date assigned for the demo is labelled as such.
 *
 * Built out of the library, not beside it. This was a hand-rolled panel with
 * its own surface, its own close button drawn as a `×` character, and every
 * value forced to mono — a second panel implementation and three separate
 * departures from the system it sits in. `Panel`, `Field` and `Badge` already
 * answer all of it, and they answer it the same way the investigation tab
 * does, which is the point: the same record should not look like two
 * different kinds of thing depending on where you meet it.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge, Button, Failed, Field, FieldList, Meter, Panel, Skeleton } from '../../design/components';
import { type SlickFeature } from '../../api/slicks';
import { SOURCES, VERIFIER, km, km2, shortId, when } from '../../format';
import { seaName } from '../../seas';
import { investigate } from '../../surfaces/tabs';

/** Which side of the slick the card sits on. */
type Side = 'right' | 'left' | 'bottom' | 'top';

const GAP = 32; // clear of the slick and of the spotlight's 14px halo
const EDGE = 16; // the card never touches the side of the map
const CORNER = 23; // the beak cannot ride up onto a rounded corner

export function SlickCard({
  slickId,
  slick,
  at,
  onClose,
}: {
  slickId: string;
  /** The record, fetched once by the map: the spotlight needs its geometry and
   *  this needs its properties. Undefined while it is in flight. */
  slick: SlickFeature | 'error' | undefined;
  /** Where the slick is on screen: its centre, and the box its shape occupies.
   *  The card clears the box, not the centre. */
  at: { x: number; y: number; box: { x0: number; y0: number; x1: number; y1: number } };
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  /**
   * Where the card actually lands, measured against the map it sits in.
   *
   * CSS anchor positioning does this natively, flipping an over-hanging box to
   * the other side on its own, but it is Chromium-only today and, more to the
   * point, a `@position-try` block cannot tell the beak which side it ended
   * up on. So the side is decided here, where both the card and its beak can
   * be told about it, in the one measurement pass the beak already needed.
   */
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    /** How far along the card's beak-bearing edge the point sits. */
    beak: number;
    /** Which side of the slick the card is on. */
    side: Side;
  }>();

  useLayoutEffect(() => {
    const el = cardRef.current;
    const map = el?.parentElement;
    if (!el || !map) return;
    const card = el.getBoundingClientRect();
    const view = map.getBoundingClientRect();
    const { box } = at;

    /*
     * Four sides, in preference order.
     *
     * Right first because a card to the right of the subject is the reading
     * order, then left, then below, then above. Each is measured against the
     * slick's own box rather than its centre, which is what kept the card
     * sitting on top of half the shape it was describing.
     */
    const room: Record<Side, number> = {
      right: view.width - box.x1 - GAP - EDGE,
      left: box.x0 - GAP - EDGE,
      bottom: view.height - box.y1 - GAP - EDGE,
      top: box.y0 - GAP - EDGE,
    };
    const needed: Record<Side, number> = {
      right: card.width,
      left: card.width,
      bottom: card.height,
      top: card.height,
    };
    const order: Side[] = ['right', 'left', 'bottom', 'top'];
    const side =
      order.find((option) => room[option] >= needed[option]) ??
      // Nothing fits: take the side with the most room and let the clamp work.
      order.reduce((best, option) => (room[option] - needed[option] > room[best] - needed[best] ? option : best));

    const vertical = side === 'top' || side === 'bottom';
    const left = vertical
      ? at.x - card.width / 2
      : side === 'right'
        ? box.x1 + GAP
        : box.x0 - GAP - card.width;
    const top = vertical
      ? side === 'bottom'
        ? box.y1 + GAP
        : box.y0 - GAP - card.height
      : at.y - CORNER - 8;

    const clamp = (value: number, size: number, extent: number) =>
      Math.min(Math.max(value, EDGE), Math.max(EDGE, extent - size - EDGE));
    const clampedLeft = clamp(left, card.width, view.width);
    const clampedTop = clamp(top, card.height, view.height);

    // The beak points at the slick's centre, wherever the card ended up, and
    // stops short of the corners it would otherwise ride onto.
    const along = vertical ? at.x - clampedLeft : at.y - clampedTop;
    const span = vertical ? card.width : card.height;

    setPlace({
      left: clampedLeft,
      top: clampedTop,
      side,
      beak: Math.min(Math.max(along, CORNER), span - CORNER),
    });
  }, [at.x, at.y, at.box, slick]);

  const p = slick && slick !== 'error' ? slick.properties : undefined;
  const verifier = typeof p?.verifier === 'string' ? VERIFIER[p.verifier] : undefined;
  const lookalike = p?.lookalikeWarning === true;
  const probability = typeof p?.probability === 'number' ? p.probability : undefined;
  // Named by the water it sits in: "34.6099 N, 31.4521 E" is not something an
  // operator holds in their head, and "off Cyprus" is. No hedge in the title,
  // because the probability is the line directly under it.
  const sea = seaName(p?.centroid);

  return (
    <div
      ref={cardRef}
      className="slick-card"
      data-side={place?.side ?? 'right'}
      style={
        {
          // The un-measured first paint is the same guess the measurement
          // usually confirms, so the card does not visibly jump into place.
          '--beak': `${place?.beak ?? CORNER}px`,
          left: `${place?.left ?? at.box.x1 + GAP}px`,
          top: `${place?.top ?? at.y - CORNER - 8}px`,
        } as CSSProperties
      }
    >
      <Panel
        variant="float"
        title={sea ? `Oil slick, ${sea}` : 'Oil slick'}
        subtitle={<span className="mono">{shortId(slickId)}</span>}
        onClose={onClose}
        footer={
          p && (
            <Button tone="primary" className="slick-card-open" onClick={() => investigate(slickId)}>
              Investigate
              <ArrowRight size={14} strokeWidth={2.25} />
            </Button>
          )
        }
      >
        {slick === 'error' && <Failed title="Details unavailable" detail={slickId} />}
        {!slick && <Skeleton rows={4} />}

        {p && (
          <>
            {lookalike && (
              <div className="slick-card-badges">
                <Badge status="warning">Possible look-alike</Badge>
              </div>
            )}

            {probability !== undefined && (
              <Meter
                label="Detection probability"
                value={probability}
                status={lookalike ? 'warning' : undefined}
              />
            )}

            <FieldList>
              <Field label="Observed" value={`${when.format(Date.parse(p.observedAt))} UTC`} />
              <Field label="Area" value={km2(p.areaM2)} />
              <Field label="Length" value={km(p.lengthM)} />
              {typeof p.components === 'number' && p.components > 1 && (
                <Field label="Parts" value={String(p.components)} />
              )}
              <Field label="Detector" value={SOURCES[String(p.kind)] ?? String(p.source)} numeric={false} />
              {verifier && (
                <Field
                  label="Verification"
                  value={verifier}
                  numeric={false}
                  status={lookalike ? 'warning' : undefined}
                />
              )}
            </FieldList>
          </>
        )}
      </Panel>
    </div>
  );
}
