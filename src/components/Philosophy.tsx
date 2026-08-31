"use client";

import { useRef } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import { SECTIONS, PRESETS } from "../audio/presets";
import { SETTLE_DELAY } from "../audio/engine";

/**
 * The one page in the app that talks.
 *
 * Everything else here is deliberately silent about itself: the HUD used to
 * carry a caption under each mode explaining what it did, which meant the
 * app was describing its own mechanism at you for the entire session. Those
 * captions are gone. The reasoning is not - it is here, behind a deliberate
 * click, where it can be read once and then left alone.
 *
 * Durations and tempi are read from the presets rather than written into the
 * prose, so retuning the engine cannot leave an essay behind that confidently
 * states the old numbers.
 */

const MIN = (seconds: number) => Math.round(seconds / 60);

/** Beat counts per visual breath. Must match PARAMS in Visualizer.tsx. */
const FOCUS_BEATS = 6;
const PUMP_BEATS = 8;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Philosophy({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus(open, panelRef);

  if (!open) return null;

  const initiation = MIN(SECTIONS[0][1]);
  const transition = MIN(SECTIONS[1][1]);
  const deep = MIN(SECTIONS[2][1]);

  const focusBpm = Math.round(PRESETS.focus.bpm);
  const pumpBpm = Math.round(PRESETS.pump.bpm);

  return (
    <div className="cmdscrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="cmdpanel phipanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phititle"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cmdhead">
          <h2 id="phititle">Philosophy</h2>
          <button
            type="button"
            className="cmdclose"
            onClick={onClose}
            aria-label="Close philosophy"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <article className="phibody">
          <p className="philede">
            This is not music to work to. It is a room you learn to work in.
          </p>

          <section className="phisection">
            <h3>Attention is conditioned, not summoned</h3>
            <p>
              You cannot decide to concentrate the way you decide to stand up.
              Concentration arrives, or it does not, and most of what we call
              productivity is really an argument with that fact. The one lever
              that reliably works is older and stranger than willpower: the
              mind learns what a place is for.
            </p>
            <p>
              A desk you have only ever worked at becomes easier to work at. A
              bed you have only ever slept in becomes easier to sleep in. The
              association does the work that effort was failing to do. What is
              missing, for most people, is a version of that room they can
              carry &mdash; one that is identical every time, that costs
              nothing to enter, and that nobody else can walk into.
            </p>
            <p>That is what this is trying to be.</p>
          </section>

          <section className="phisection">
            <h3>Pavlov&rsquo;s dogs, correctly understood</h3>
            <p>
              The experiment is usually remembered as a trick: ring a bell,
              feed a dog, and eventually the bell alone makes it salivate. The
              interesting part is not the bell. It is that the dog was not
              persuaded, trained by reward, or asked. A neutral thing was
              placed next to a real thing, again and again, until the neutral
              thing acquired the real thing&rsquo;s power.
            </p>
            <p>
              Sound is unusually good at being that neutral thing. It arrives
              without being looked at, it is present for the whole duration of
              a state rather than at its edges, and it can be made identical on
              every repetition in a way that a room, a chair, or a time of day
              never can be.
            </p>
            <p>
              So this app is not trying to make you focus. It is trying to
              become the thing that focus happens next to, often enough that
              the order reverses. The first few sessions, the sound follows the
              work. After enough of them, the work follows the sound. Nothing
              here is a shortcut &mdash; it is a deposit, and the interest is
              paid in months.
            </p>
          </section>

          <section className="phisection">
            <h3>
              {initiation} &rarr; {transition} &rarr; {deep}, then {transition}
              {" "}
              &rarr; {deep}, forever
            </h3>
            <p>
              A session is not a flat wash. It has a shape, and the shape is
              the argument.
            </p>
            <ul className="philist">
              <li>
                <strong>Initiation, {initiation} minutes.</strong> The doorway.
                Deliberately short &mdash; long enough to be a threshold, too
                short to be a wait. This is the part your nervous system will
                eventually recognise before you consciously do, the way you
                relax at the sound of a particular front door.
              </li>
              <li>
                <strong>Transition, {transition} minutes.</strong> The ramp.
                Density and movement build slowly enough that no single moment
                announces itself. Nothing here asks to be noticed; noticing is
                exactly the failure mode.
              </li>
              <li>
                <strong>Deep, {deep} minutes.</strong> The work. Roughly one
                ultradian cycle &mdash; the natural period over which sustained
                attention rises, holds and decays before the body wants a
                break. The soundscape is at its most stable here and changes
                least, because this is the stretch you are supposed to forget
                it entirely.
              </li>
            </ul>
            <p>
              Then it loops &mdash; but back to Transition, never to Initiation.
              You cross a threshold once. Replaying the doorway every {deep}
              {" "}
              minutes would mean announcing a beginning to somebody who is
              already inside, which is precisely how most focus tools break the
              state they exist to protect.
            </p>
          </section>

          <section className="phisection">
            <h3>The click</h3>
            <p>
              When you change mode, the two soundscapes cross-fade. Then,{" "}
              {SETTLE_DELAY.toFixed(1)} seconds after the change begins &mdash;
              and a beat and a half after the fade has already finished &mdash;
              there is a click.
            </p>
            <p>
              It is not a notification and it is not a beep. A beep has a
              pitch, and a pitch is a message. This is two very short bursts of
              filtered noise about twenty milliseconds apart, shaped so the
              attack is instant and the decay is not. That interval is
              deliberate: below roughly thirty milliseconds the ear fuses two
              events into one textured object rather than hearing two. What you
              get is not a sound the app made. It is the sound of a mechanism
              &mdash; a light switch reaching the end of its travel.
            </p>
            <p>
              The delay is the whole point. If the click landed with the
              change, it would be a confirmation that something was happening.
              Landing after the fade has completed, it says something quite
              different: <em>that is done, and it has set.</em> It is a full
              stop, not a comma.
            </p>
            <p>
              It is also, in the strict sense, a conditioned stimulus you are
              building for yourself. It costs a fraction of a second, it never
              fires unbidden, and it always means the same thing. Those are the
              only three properties a cue needs.
            </p>
          </section>

          <section className="phisection">
            <h3>Two clocks</h3>
            <p>
              Changing mode does not restart your session, because it did not
              interrupt it &mdash; you did not stop working, you changed the
              weather. So the session clock keeps its number.
            </p>
            <p>
              But something did happen, and a clock that ignores it is lying by
              omission. So it splits. A second clock, in red, takes the
              session&rsquo;s number and spends it back down to zero, landing
              on 0:00 at the exact instant the click sounds. It then counts the
              new mode&rsquo;s settling, and when the settling is over, a{" "}
              <span className="phiglyph">+</span> appears and the two fold back
              into one.
            </p>
            <p>
              The <span className="phiglyph">+</span> is not arithmetic. The
              settling time was always inside the session time. It is the two
              readings being shown as one thing again.
            </p>
          </section>

          <section className="phisection">
            <h3>Nothing here is a recording</h3>
            <p>
              There are no audio files. Every note you hear is generated in
              your browser, in real time, from oscillators and filtered noise
              assembled while it plays. Nothing loops, because there is no loop
              to repeat &mdash; the same session run twice is genuinely two
              different performances of one idea.
            </p>
            <p>
              What is fixed is the character. Each session is given a single
              seed at the moment it begins, so pausing and resuming returns you
              to the same performance rather than a new one. Continuity was
              worth more than variety.
            </p>
          </section>

          <section className="phisection">
            <h3>The image</h3>
            <p>
              The visualizer is not decoration and it is not a spectrum
              analyser. It is driven by the same numbers as the sound. Under
              Focus, the field completes one breath every {FOCUS_BEATS} beats
              of the {focusBpm}&nbsp;BPM pulse you are hearing; under Pump,
              every {PUMP_BEATS} beats of {pumpBpm}. Those periods are not
              similar-looking values picked by eye &mdash; they are read from
              the same preset the engine reads, so the picture cannot be at a
              tempo the music is not playing.
            </p>
            <p>
              That constraint is why Focus and Pump both move faster than they
              once did. The old periods were round numbers of seconds, and a
              round number of seconds is almost never a round number of beats:
              a 7.5-second breath against a {focusBpm}&nbsp;BPM pulse completes
              7.51 beats, so its peak lands a little later in the bar every
              time round and walks slowly through the whole cycle. Nobody sees
              that as drift. They see the screen lagging the music and then
              catching up, and they cannot say why.
            </p>
            <p>
              Peripheral vision is far more sensitive to rate of change than to
              detail, which is exactly why this is worth being strict about.
              You are not meant to watch this. You are meant to have it in the
              corner of your eye for an hour without it ever once disagreeing
              with what you are hearing.
            </p>
            <p>
              Relax and Sleep have no pulse layer at all, so they keep free
              periods measured in seconds. There is no grid for them to be off,
              and imposing one would make the two modes whose entire point is
              that nothing is counting feel counted.
            </p>
            <p>
              One honest limit: the two share a <em>rate</em>, not a downbeat.
              Nothing on screen flashes on the beat, so there is no sharp
              attack that could be seen to land in the wrong place &mdash; but
              the visual cycle begins when the page loads, not when the bar
              does.
            </p>
          </section>

          <section className="phisection">
            <h3>What it deliberately does not do</h3>
            <p>
              There is no account, no sign-in, no server, and no analytics.
              Nothing you do here is transmitted anywhere, because nothing here
              needs to be. The session history is written to your own browser
              and can be exported or erased by you, in the same panel that
              shows it.
            </p>
            <p>
              There is no streak, no badge, no daily goal and no notification.
              Those mechanisms work by manufacturing a small anxiety and then
              selling you relief from it &mdash; which is the exact opposite of
              what a room you can think in is for. The measurement exists so
              you can look at it if you want to. It will never come looking for
              you.
            </p>
          </section>

          <p className="phiclose">
            Put it on. Do the work. Let the association build. In a month, the
            first thirty seconds will be doing what the first twenty minutes
            used to.
          </p>
        </article>
      </div>
    </div>
  );
}
