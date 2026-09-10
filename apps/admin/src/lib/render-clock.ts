import 'server-only';

/**
 * The instant a server render measures relative times against.
 *
 * ## Why this exists at all
 *
 * Components that print "3m ago" used to read `Date.now()` while rendering.
 * That is harmless in a Server Component and a defect in a client one, because
 * React renders a client component TWICE — once on the server into HTML, once
 * in the browser to hydrate it — and an ambient clock gives a different answer
 * on each pass. When a minute ticks in the gap the two disagree, React reports
 * that the server text did not match the client, and throws away the server
 * tree for the whole boundary.
 *
 * The cure is to stop asking the clock inside the component and to pass the
 * instant in, so both passes are pure functions of the same inputs. This is
 * where that instant is decided.
 *
 * ## Why it is a function here and not `Date.now()` at the call site
 *
 * `Date.now()` written directly in a component body is an impure call during
 * render, and the React Compiler lint rule refuses it — correctly, because it
 * cannot tell a Server Component (renders once, per request, on one machine)
 * from a client one (renders twice, on two). Naming it here says which case
 * this is, and puts the reasoning somewhere a reader will find it. The same
 * shape as `getGreeting()` on the dashboard, which reads the hour.
 *
 * `server-only` because that distinction is the whole point: importing this
 * into a client component would reintroduce exactly the bug it removes, and
 * this makes that a build error rather than a code review.
 */
export function serverRenderInstant(): number {
  return Date.now();
}
