import React, { useCallback, useEffect, useState } from 'react';
import type {
  StorageAction,
  StorageFamilyView,
  StorageKeyDetail,
  StorageListing,
  StorageOverview,
  StorageScope,
  WriteHealth,
} from '../../shared/types/storage';
import { act, fetchKey, fetchListing, fetchOverview } from './api';
import { RankBar, ReleaseChart, TrendChart, UsageBar, type UsageSlice } from './charts';
import {
  GROUPS,
  METHOD_WORDS,
  ago,
  bytes,
  count,
  colorOf,
  groupOf,
  share,
  shortDay,
  until,
  whole,
} from './format';

/**
 * The moderators' storage dashboard.
 *
 * One page that scrolls, and two it opens: a listing of every key a map day, a relay post or a
 * family holds, and one key with what it holds. It answers, in order: does Redis take writes,
 * how full is it (and how much of that cannot be seen), what fills it, how that has moved, and
 * what will leave by itself. The changes are at the foot of the page they act on, and each wants
 * a second tap or the subreddit's name, as the menu's purge does.
 */

type Screen =
  | { kind: 'overview' }
  | { kind: 'listing'; scope: StorageScope }
  | { kind: 'key'; name: string };

export const StorageApp: React.FC = () => {
  const [stack, setStack] = useState<Screen[]>([{ kind: 'overview' }]);
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [writes, setWrites] = useState<WriteHealth | null>(null);
  /** What the last change did, kept above the overview once its page has gone. */
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const o = await fetchOverview();
      setOverview(o);
      setWrites(o.writes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (s: Screen) => {
    setStack((st) => [...st, s]);
    setNotice(null);
    window.scrollTo(0, 0);
  };
  const back = () => {
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
    window.scrollTo(0, 0);
  };
  const screen = stack[stack.length - 1]!;

  const check = async () => {
    const r = await act({ kind: 'probe' });
    if (r.writes) setWrites(r.writes);
  };

  return (
    <div className="sd">
      <header className="sd-top">
        {stack.length > 1 ? (
          <button type="button" className="sd-word sd-back" onClick={back}>
            ‹ Back
          </button>
        ) : (
          <span className="sd-kicker">
            Redis storage{overview?.subreddit ? ` · r/${overview.subreddit}` : ''}
          </span>
        )}
        <span className="sd-top__right">
          {overview && <span className="sd-mute">read {ago(overview.at)}</span>}
          <button
            type="button"
            className="sd-word"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Read again"
          >
            {loading ? '…' : '↻'}
          </button>
        </span>
      </header>

      {writes && <WritesLine writes={writes} onCheck={check} brief={screen.kind !== 'overview'} />}

      {error && !overview && <p className="sd-error">{error}</p>}
      {!overview && !error && <p className="sd-mute sd-loading">Adding up what Redis holds…</p>}

      {notice && screen.kind === 'overview' && <p className="sd-sentence sd-notice">{notice}</p>}
      {overview && screen.kind === 'overview' && <Overview data={overview} open={open} />}
      {overview && screen.kind === 'listing' && (
        <ListingScreen
          key={JSON.stringify(screen.scope)}
          scope={screen.scope}
          overview={overview}
          writes={writes}
          open={open}
          onDropped={(message) => {
            // The day is gone, and its page with it: back to the overview, which says so.
            setStack([{ kind: 'overview' }]);
            setNotice(message);
            window.scrollTo(0, 0);
            void load();
          }}
        />
      )}
      {overview && screen.kind === 'key' && (
        <KeyScreen
          key={screen.name}
          name={screen.name}
          writes={writes}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
};

/**
 * Whether Redis takes writes: one line when it does, the whole story when it does not, and one
 * line again on the pages under the overview, which have told it already.
 */
const WritesLine: React.FC<{
  writes: WriteHealth;
  onCheck: () => Promise<void>;
  brief: boolean;
}> = ({ writes, onCheck, brief }) => {
  const [busy, setBusy] = useState(false);
  const recheck = (
    <button
      type="button"
      className="sd-word sd-word--small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onCheck().finally(() => setBusy(false));
      }}
    >
      {busy ? 'Checking…' : 'Check again'}
    </button>
  );
  if (writes.set) {
    return (
      <p className="sd-writes sd-writes--ok">
        <span className="sd-status sd-status--good">● Writes go through</span>
        <span className="sd-mute"> checked {ago(writes.checkedAt)}</span> {recheck}
      </p>
    );
  }
  if (brief) {
    return (
      <p className="sd-writes sd-writes--ok">
        <span className="sd-status sd-status--alert">
          ▲ {writes.quota ? 'Writes blocked' : 'Writes failing'}
          {writes.del ? ', deletes go through' : ''}
        </span>{' '}
        {recheck}
      </p>
    );
  }
  return (
    <section className="sd-writes sd-writes--blocked" aria-live="polite">
      <p className="sd-status sd-status--alert">
        ▲ {writes.quota ? 'Writes blocked by Reddit' : 'Writes failing'}
      </p>
      <p className="sd-sentence">
        {writes.quota
          ? 'This install is over its Redis quota and Reddit has stopped every write: runs, relay turns, colours and settings all fail. Reads still work, so everything here is live. Only Reddit Dev Platform Support can lift the block.'
          : `Redis refused a one-minute test value: ${writes.error ?? 'no reason given'}.`}{' '}
        {writes.del
          ? 'Deletes still go through, so the changes below can free space.'
          : 'Deletes fail too, so nothing below can change Redis until then.'}
      </p>
      <p className="sd-mute">
        Checked {ago(writes.checkedAt)} {recheck}
      </p>
    </section>
  );
};

const slicesOf = (families: readonly StorageFamilyView[]): UsageSlice[] =>
  GROUPS.map((g) => ({
    group: g.id,
    bytes: families.filter((f) => groupOf(f.id) === g.id).reduce((n, f) => n + f.bytes, 0),
  }));

const familyScope = (f: StorageFamilyView, o: StorageOverview): StorageScope | null => {
  switch (f.id) {
    case 'users':
    case 'runs':
    case 'awards':
    case 'notify':
    case 'other':
      return { kind: 'family', family: f.id };
    case 'relayTowers':
    case 'relayPlayers': {
      const live = o.relays.find((r) => r.live) ?? o.relays[0];
      return live ? { kind: 'relay', postId: live.postId } : null;
    }
    default: {
      const live = o.maps.find((m) => m.live) ?? o.maps[0];
      return live ? { kind: 'map', day: live.day } : null;
    }
  }
};

const Overview: React.FC<{ data: StorageOverview; open: (s: Screen) => void }> = ({
  data,
  open,
}) => {
  const [lookup, setLookup] = useState('');
  const slices = slicesOf(data.families);
  const unseen = data.unseen?.atLeast ?? 0;
  const today = data.history.find((h) => h.day === new Date(data.at).toISOString().slice(0, 10));
  const trend = [
    ...data.history.filter((h) => h !== today),
    {
      day: new Date(data.at).toISOString().slice(0, 10),
      bytes: data.bytes,
      keys: data.keys,
      players: Math.round(data.dailyPlayers),
    },
  ];
  const within = (days: number) => data.releases.slice(0, days).reduce((n, r) => n + r.bytes, 0);
  const maxFamily = Math.max(...data.families.map((f) => f.bytes));

  return (
    <main>
      <section className="sd-hero">
        <p>
          <span className="sd-big">{bytes(data.bytes)}</span>
          <span className="sd-dim"> seen of {bytes(data.limit)}</span>
          <span className="sd-mute"> · {share(data.bytes, data.limit)}</span>
        </p>
        {data.unseen && (
          <p className="sd-unseen">
            <span className="sd-status sd-status--alert">▨ At least {bytes(unseen)} unseen</span>{' '}
            <span className="sd-sentence">
              {data.unseen.note}
              {data.unseen.goneBy ? ` The last of them goes ${shortDay(data.unseen.goneBy)}.` : ''}
            </span>
          </p>
        )}
        <UsageBar slices={slices} unseen={unseen} limit={data.limit} />
        <ul className="sd-legend">
          {slices
            .filter((s) => s.bytes > 0)
            .map((s) => (
              <li key={s.group}>
                <i style={{ background: colorOf(s.group) }} />
                {GROUPS.find((g) => g.id === s.group)!.label}
                <span className="sd-dim"> {bytes(s.bytes)}</span>
              </li>
            ))}
          {unseen > 0 && (
            <li>
              <i className="sd-legend__hatch" />
              Unseen<span className="sd-dim"> ≥{bytes(unseen)}</span>
            </li>
          )}
        </ul>
        <p className="sd-sentence sd-dim">
          {data.dailyPlayers > 0 ? (
            <>
              {whole(data.dailyPlayers)} players a day keep {bytes(data.perPlayer)} each
              {data.capacity !== null && <>; the limit holds about {whole(data.capacity)} a day</>}.
            </>
          ) : (
            'Nobody has played yet.'
          )}{' '}
          {data.keys > 0 && <>{whole(data.keys)} keys counted.</>}
        </p>
      </section>

      <h2 className="sd-kicker">What uses it</h2>
      <ul className="sd-rows">
        {data.families
          .filter((f) => f.bytes > 0 || f.note)
          .map((f) => {
            const scope = familyScope(f, data);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  className="sd-row"
                  disabled={!scope}
                  onClick={() => scope && open({ kind: 'listing', scope })}
                >
                  <span className="sd-row__main">
                    <span className="sd-row__name">
                      <i className="sd-dot" style={{ background: colorOf(groupOf(f.id)) }} />
                      {f.label}
                    </span>
                    <span className="sd-row__value">{bytes(f.bytes)}</span>
                  </span>
                  <RankBar value={f.bytes} max={maxFamily} color={colorOf(groupOf(f.id))} />
                  <span className="sd-row__sub">
                    {count(f.keys, 'key')} · {METHOD_WORDS[f.method]} · {f.lifetime}
                    {f.note ? <span className="sd-row__note">{f.note}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>

      <h2 className="sd-kicker">Seen, day by day</h2>
      <TrendChart points={trend} limit={data.limit} blocked={!data.writes.set} unseen={unseen} />

      <h2 className="sd-kicker">What expires by itself</h2>
      <ReleaseChart releases={data.releases} />
      <p className="sd-sentence sd-dim">
        If nothing new were written, {bytes(within(7))} of what is seen goes in a week,{' '}
        {bytes(within(15))} by {shortDay(data.releases[14]?.day ?? data.at)} and{' '}
        {bytes(within(data.releases.length))} within {data.releases.length} days.
        {data.unseen?.goneBy ? ' The unseen part is not in this chart.' : ''}
      </p>
      <ul className="sd-legend">
        {GROUPS.map((g) => (
          <li key={g.id}>
            <i style={{ background: g.color }} />
            {g.label}
          </li>
        ))}
      </ul>

      <h2 className="sd-kicker">Maps stored</h2>
      <ul className="sd-rows">
        {data.maps.map((m) => (
          <li key={m.day}>
            <button
              type="button"
              className="sd-row"
              onClick={() => open({ kind: 'listing', scope: { kind: 'map', day: m.day } })}
            >
              <span className="sd-row__main">
                <span className="sd-row__name">
                  {shortDay(m.day)}
                  {m.live && <span className="sd-tag">live</span>}
                </span>
                <span className="sd-row__value">{bytes(m.bytes)}</span>
              </span>
              <span className="sd-row__sub">
                {count(m.players, 'player')} · {count(m.keys, 'key')} · goes {shortDay(m.expiresAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <h2 className="sd-kicker">Relay posts</h2>
      {data.relays.length === 0 && <p className="sd-mute">None found.</p>}
      <ul className="sd-rows">
        {data.relays.map((r) => (
          <li key={r.postId}>
            <button
              type="button"
              className="sd-row"
              onClick={() => open({ kind: 'listing', scope: { kind: 'relay', postId: r.postId } })}
            >
              <span className="sd-row__main">
                <span className="sd-row__name">
                  {r.day ? shortDay(r.day) : r.postId}
                  {r.live && <span className="sd-tag">live</span>}
                </span>
                <span className="sd-row__value">{bytes(r.bytes)}</span>
              </span>
              <span className="sd-row__sub">
                {count(r.towers, 'tower')} · {count(r.players, 'player')} ·{' '}
                {r.expiresAt ? `goes ${shortDay(r.expiresAt)}` : 'no expiry'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {data.largest && (
        <>
          <h2 className="sd-kicker">Largest single value</h2>
          <p className="sd-sentence">
            {data.largest.label}: <b>{bytes(data.largest.bytes)}</b>
            <span className="sd-dim">
              , {share(data.largest.bytes, data.requestLimit)} of the {bytes(data.requestLimit)} one
              request can carry.
            </span>
          </p>
        </>
      )}

      <h2 className="sd-kicker">Look up a key</h2>
      <form
        className="sd-lookup"
        onSubmit={(e) => {
          e.preventDefault();
          const name = lookup.trim();
          if (name) open({ kind: 'key', name });
        }}
      >
        <input
          className="sd-input"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="map:current"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Key name"
        />
        <button type="submit" className="sd-word" disabled={!lookup.trim()}>
          Look up
        </button>
      </form>
      <p className="sd-mute sd-foot">
        Sizes are added up key by key: Devvit&apos;s Redis cannot say how full it is. A key costs
        its name, its value and 64 bytes beside it.
      </p>
    </main>
  );
};

const ListingScreen: React.FC<{
  scope: StorageScope;
  overview: StorageOverview;
  writes: WriteHealth | null;
  open: (s: Screen) => void;
  onDropped: (message: string) => void;
}> = ({ scope, overview, writes, open, onDropped }) => {
  const [listing, setListing] = useState<StorageListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchListing(scope).then(setListing, (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [scope]);

  const map = scope.kind === 'map' ? overview.maps.find((m) => m.day === scope.day) : null;
  const relay =
    scope.kind === 'relay' ? overview.relays.find((r) => r.postId === scope.postId) : null;
  const droppable = (map && !map.live) || (relay && !relay.live);
  const maxGroup = Math.max(0, ...(listing?.groups ?? []).map((g) => g.bytes));

  return (
    <main>
      <h1 className="sd-title">
        {scope.kind === 'map'
          ? `Map, ${shortDay(scope.day)}`
          : scope.kind === 'relay'
            ? `Relay, ${relay?.day ? shortDay(relay.day) : scope.postId}`
            : (listing?.title ?? 'Keys')}
        {(map?.live || relay?.live) && <span className="sd-tag">live</span>}
      </h1>
      {error && <p className="sd-error">{error}</p>}
      {!listing && !error && <p className="sd-mute sd-loading">Reading every key it holds…</p>}
      {listing && (
        <>
          <p className="sd-sentence">
            <b>{bytes(listing.bytes)}</b>
            <span className="sd-dim"> in {count(listing.total, 'key')} found</span>
            {(map || relay) && (
              <span className="sd-dim">
                {' '}
                · expires {shortDay((map?.expiresAt ?? relay?.expiresAt ?? overview.at) as number)}
              </span>
            )}
          </p>
          {listing.note && <p className="sd-sentence sd-dim">{listing.note}</p>}

          {listing.groups.length > 1 && (
            <ul className="sd-rows sd-rows--tight">
              {listing.groups.map((g) => (
                <li key={g.label} className="sd-row sd-row--static">
                  <span className="sd-row__main">
                    <span className="sd-row__name">{g.label}</span>
                    <span className="sd-row__value">{bytes(g.bytes)}</span>
                  </span>
                  <RankBar value={g.bytes} max={maxGroup} color="#4ff2ff" />
                  <span className="sd-row__sub">{count(g.keys, 'key')}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="sd-kicker">
            {listing.rows.length < listing.total
              ? `The ${listing.rows.length} largest`
              : 'Every key, largest first'}
          </h2>
          <ul className="sd-rows">
            {listing.rows.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  className="sd-row"
                  onClick={() => open({ kind: 'key', name: r.key })}
                >
                  <span className="sd-row__main">
                    <span className="sd-row__key">{r.key}</span>
                    <span className="sd-row__value">{bytes(r.bytes)}</span>
                  </span>
                  <span className="sd-row__sub">
                    {r.type} · {lengthWords(r.type, r.length)} · goes {until(r.expiresAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {droppable && (
            <Drop
              what={
                map
                  ? `the ${shortDay(map.day)} map`
                  : `the ${relay?.day ? shortDay(relay.day) : ''} relay post`
              }
              detail={
                map
                  ? 'Deletes its board, plots, keeps, held land, take and comment records, and the runs standing on it. Player records stay. Its post will show an empty board.'
                  : 'Deletes its towers, crews, summaries and players. Its post will show no towers.'
              }
              subreddit={overview.subreddit}
              writes={writes}
              action={(confirm) =>
                map
                  ? { kind: 'drop-map', day: map.day, confirm }
                  : { kind: 'drop-relay', postId: relay!.postId, confirm }
              }
              onDone={onDropped}
            />
          )}
        </>
      )}
    </main>
  );
};

const lengthWords = (type: string, n: number): string =>
  type === 'string'
    ? `${whole(n)} chars`
    : type === 'hash'
      ? `${whole(n)} fields`
      : type === 'zset'
        ? `${whole(n)} members`
        : '';

/** Why a change would not go through right now, or null when it might. */
const blockedReason = (writes: WriteHealth | null): string | null =>
  writes && !writes.del ? 'Redis is refusing deletes and expiries while writes are blocked.' : null;

/** Drop a closed day whole, once the subreddit's name is typed back. */
const Drop: React.FC<{
  what: string;
  detail: string;
  subreddit: string;
  writes: WriteHealth | null;
  action: (confirm: string) => StorageAction;
  onDone: (message: string) => void;
}> = ({ what, detail, subreddit, writes, action, onDone }) => {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const reason = blockedReason(writes);
  const matches = typed.trim().toLowerCase() === subreddit.toLowerCase() && subreddit !== '';
  return (
    <section className="sd-danger">
      <h2 className="sd-kicker sd-kicker--alert">Drop {what}</h2>
      <p className="sd-sentence sd-dim">{detail} It cannot be undone.</p>
      {reason ? (
        <p className="sd-sentence sd-mute">{reason}</p>
      ) : (
        <form
          className="sd-lookup"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!matches) return;
            setBusy(true);
            const r = await act(action(typed.trim())).catch((err: unknown) => ({
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            }));
            setBusy(false);
            if (r.ok) onDone(r.message);
            else setResult(r.message);
          }}
        >
          <input
            className="sd-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type ${subreddit} to drop it`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Subreddit name"
          />
          <button type="submit" className="sd-word sd-word--alert" disabled={!matches || busy}>
            {busy ? 'Dropping…' : 'Drop'}
          </button>
        </form>
      )}
      {result && <p className="sd-sentence">{result}</p>}
    </section>
  );
};

const EXPIRIES = [
  { seconds: 3600, word: '1 hour' },
  { seconds: 86_400, word: '1 day' },
  { seconds: 7 * 86_400, word: '7 days' },
] as const;

const KeyScreen: React.FC<{
  name: string;
  writes: WriteHealth | null;
  onChanged: () => void;
}> = ({ name, writes, onChanged }) => {
  const [detail, setDetail] = useState<StorageKeyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchKey(name).then(setDetail, (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [name]);
  useEffect(reload, [reload]);

  const run = async (a: StorageAction) => {
    setBusy(true);
    const r = await act(a).catch((err: unknown) => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    setBusy(false);
    setArmed(false);
    setResult(r.message);
    if (r.ok) {
      reload();
      onChanged();
    }
  };

  const reason = blockedReason(writes);
  return (
    <main>
      <h1 className="sd-title sd-title--key">{name}</h1>
      {error && <p className="sd-error">{error}</p>}
      {!detail && !error && <p className="sd-mute sd-loading">Reading it…</p>}
      {detail && (
        <>
          {detail.meaning ? (
            <p className="sd-sentence">
              <span className="sd-kicker sd-kicker--inline">{detail.meaning.family}</span>
              {detail.meaning.what}.
              <span className="sd-dim"> Lives {detail.meaning.lifetime.toLowerCase()}.</span>
            </p>
          ) : (
            <p className="sd-sentence sd-dim">No key the game declares looks like this one.</p>
          )}
          {!detail.exists ? (
            <p className="sd-sentence">It is not in Redis.</p>
          ) : (
            <>
              <dl className="sd-facts">
                <dt>Size</dt>
                <dd>{bytes(detail.bytes)}</dd>
                <dt>Holds</dt>
                <dd>
                  {detail.type}, {lengthWords(detail.type, detail.length)}
                </dd>
                <dt>Expires</dt>
                <dd>
                  {detail.expiresAt === null
                    ? 'Never'
                    : `${shortDay(detail.expiresAt)} ${new Date(detail.expiresAt).toISOString().slice(11, 16)} UTC, ${until(detail.expiresAt)}`}
                </dd>
              </dl>
              <h2 className="sd-kicker">
                {detail.truncated ? 'The start of what it holds' : 'What it holds'}
              </h2>
              <Preview detail={detail} />

              <h2 className="sd-kicker">Change it</h2>
              {reason ? (
                <p className="sd-sentence sd-mute">{reason}</p>
              ) : (
                <>
                  <p className="sd-actions">
                    <span className="sd-dim">Expire in</span>
                    {EXPIRIES.map((e) => (
                      <button
                        key={e.seconds}
                        type="button"
                        className="sd-word"
                        disabled={busy}
                        onClick={() =>
                          void run({ kind: 'expire', key: name, seconds: e.seconds, confirm: name })
                        }
                      >
                        {e.word}
                      </button>
                    ))}
                  </p>
                  {detail.meaning?.vital && (
                    <p className="sd-sentence sd-alert">The game needs this key to run.</p>
                  )}
                  <p className="sd-actions">
                    {armed ? (
                      <>
                        <button
                          type="button"
                          className="sd-word sd-word--alert"
                          disabled={busy}
                          onClick={() => void run({ kind: 'delete', key: name, confirm: name })}
                        >
                          {busy ? 'Deleting…' : 'Yes, delete it'}
                        </button>
                        <button type="button" className="sd-word" onClick={() => setArmed(false)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="sd-word sd-word--alert"
                        onClick={() => setArmed(true)}
                      >
                        Delete
                      </button>
                    )}
                  </p>
                </>
              )}
            </>
          )}
          {result && <p className="sd-sentence">{result}</p>}
        </>
      )}
    </main>
  );
};

/** A value's start, pretty-printed when it is JSON. */
const Preview: React.FC<{ detail: StorageKeyDetail }> = ({ detail }) => {
  const p = detail.preview;
  if (!p) return null;
  if (p.kind === 'string') {
    let text = p.text;
    if (!detail.truncated) {
      try {
        text = JSON.stringify(JSON.parse(p.text), null, 1);
      } catch {
        // Not JSON: shown as it is.
      }
    }
    return <pre className="sd-pre">{text}</pre>;
  }
  if (p.kind === 'hash') {
    return (
      <dl className="sd-pairs">
        {p.fields.map((f) => (
          <React.Fragment key={f.field}>
            <dt>{f.field}</dt>
            <dd>{f.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }
  return (
    <dl className="sd-pairs">
      {p.members.map((m) => (
        <React.Fragment key={m.member}>
          <dt>{m.member}</dt>
          <dd>{m.score}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};
