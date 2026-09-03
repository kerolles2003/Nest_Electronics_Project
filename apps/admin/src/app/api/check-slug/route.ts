import { NextResponse, type NextRequest } from 'next/server';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { requireAdminActor } from '@/lib/api/identity';

/**
 * Is this slug free — answered by the API, and NEVER guessed.
 *
 * ## What this replaces, and why it mattered
 *
 * The Supabase version returned `{ exists: false }` on every failure path. A
 * database error, a missing service, any thrown exception: all of them answered
 * "the slug is free".
 *
 * The product form is built to trust that answer. So a check that could not
 * reach the database told the operator to carry on, and the create then failed
 * on the unique index — after they had filled in the name, the price, the
 * category, the specs and the images. **A uniqueness check that says
 * "available" when it does not know is worse than no check**, because the form
 * treats silence and certainty identically.
 *
 * ## Fails closed
 *
 * There is no `catch` returning a cheerful default. An API failure is a 502 with
 * `available: null`, and the form must treat that as "unknown" rather than as
 * "free". The one thing this route will never do again is invent an answer.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // The role check is the API's, but this route must not be an unauthenticated
  // probe of which slugs exist: that is a slow enumeration of the catalogue,
  // including products that are not published yet.
  await requireAdminActor();

  const params = request.nextUrl.searchParams;
  const slug = params.get('slug')?.trim() ?? '';
  const type = params.get('type') ?? 'product';

  if (slug === '') {
    // No slug is not an error and not an availability answer. Saying `false`
    // here is what the old route did for every failure, and it is the same lie.
    return NextResponse.json({ available: null, suggestion: null, reason: 'no slug given' });
  }

  const result = await tryApi(() =>
    api.checkSlugAvailability({
      type,
      slug,
      ...(params.get('excludeId') === null ? {} : { excludeId: params.get('excludeId') as string }),
    }),
  );

  if (!result.ok) {
    /*
     * `available: null`, and a status that is not 200. The form renders unknown
     * — neither a tick nor a cross — because both would be a claim this route
     * cannot support.
     */
    return NextResponse.json(
      { available: null, suggestion: null, reason: result.error.message },
      { status: result.error.kind === 'validation' ? 400 : 502 },
    );
  }

  return NextResponse.json(result.data.data);
}
