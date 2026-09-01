/**
 * One way to render a failed API call.
 *
 * Pages pass an already-categorised message from `customerMessage()`, so the
 * wording rule lives in the error layer rather than being re-invented per
 * screen. The `requestId` is shown when present because the API echoes it on
 * every response and it is the bridge between a customer's screenshot and the
 * server-side cause.
 */
export function ApiErrorNotice({
  title,
  message,
  requestId,
}: {
  title: string;
  message: string;
  requestId?: string | null;
}) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <h2 className="font-semibold text-red-900">{title}</h2>
      <p className="mt-1 text-sm text-red-800">{message}</p>
      {requestId ? (
        <p className="mt-2 text-xs text-red-700/70">Reference: {requestId}</p>
      ) : null}
    </div>
  );
}
