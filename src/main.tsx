import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type State = {
  id: string;
  people: { id: string; name: string }[];
  me: string;
  isHost: boolean;
  drawn: boolean;
  recipient: string | null;
  expires: number;
  requiresPin?: boolean;
};

const sessionId = location.pathname.match(/^\/session\/([\w-]+)$/)?.[1];
const key = (id: string) => `santa:${id}`;

function SantaIcon() {
  return (
    <svg className="santa-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M13 28C14 8 33 4 48 17l6 9H13Z" fill="#c52e3a" />
      <circle cx="54" cy="23" r="7" fill="#fffaf0" />
      <ellipse cx="32" cy="39" rx="20" ry="21" fill="#fffaf0" />
      <ellipse cx="32" cy="35" rx="15" ry="13" fill="#f2c4a7" />
      <rect x="10" y="22" width="42" height="10" rx="5" fill="#fffaf0" />
      <path
        d="M23 34h3m12 0h3"
        stroke="#422a29"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="20" cy="40" r="3" fill="#e69589" />
      <circle cx="44" cy="40" r="3" fill="#e69589" />
      <path
        d="M32 43c-7-7-15-1-11 3 4 4 9 1 11-1 2 2 7 5 11 1 4-4-4-10-11-3Z"
        fill="#fffaf0"
      />
      <path
        d="M27 49q5 5 10 0"
        fill="none"
        stroke="#9f343b"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <ellipse cx="32" cy="40" rx="4" ry="3" fill="#ecab91" />
    </svg>
  );
}

function ResultExpiry({ expires }: { expires: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const minutes = Math.max(0, Math.ceil((expires - now) / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [
    days > 0 ? `${days} ${days === 1 ? "dag" : "dagar"}` : null,
    hours > 0 ? `${hours} ${hours === 1 ? "timme" : "timmar"}` : null,
    remainingMinutes > 0
      ? `${remainingMinutes} ${remainingMinutes === 1 ? "minut" : "minuter"}`
      : null,
  ].filter(Boolean);
  const deadline = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(expires);

  return (
    <div className="result-expiry">
      <p>
        {minutes > 0
          ? `Resultatet finns kvar i ${parts.join(", ")}.`
          : "Sessionens giltighetstid har gått ut."}
      </p>
      <p className="small">
        Till <time dateTime={new Date(expires).toISOString()}>{deadline}</time>,
        eller tills värden avslutar sessionen.
      </p>
    </div>
  );
}

function App() {
  const [state, setState] = useState<State | null>(null),
    [name, setName] = useState(""),
    [pin, setPin] = useState(""),
    [mode, setMode] = useState<"join" | "resume">("join"),
    [participantId, setParticipantId] = useState(""),
    [lobby, setLobby] = useState<{
      people: State["people"];
      drawn: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [revealed, setRevealed] = useState(false),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState(false),
    [removeTarget, setRemoveTarget] = useState<{
      id: string;
      name: string;
    } | null>(null);

  const [secret, setSecret] = useState(() =>
    sessionId ? sessionStorage.getItem(key(sessionId)) : null,
  );

  async function request(path: string, method = "GET", body?: unknown) {
    const res = await fetch(`/api/sessions${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return null;
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error(
        "Servern kunde inte nås. Sessionens backend behöver köras tillsammans med hemsidan.",
      );
    }
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(data.error), { status: res.status });
    return data;
  }

  useEffect(() => {
    if (!sessionId || !secret) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await request(`/${sessionId}`);
        if (active) {
          setState(data);
          setOffline(false);
        }
      } catch (e) {
        if (active) {
          const err = e as Error & { status?: number };
          if (err.status === 404 || err.status === 401) {
            setError(err.message);
            setSecret(null);
            sessionStorage.removeItem(key(sessionId));
            setState(null);
          } else setOffline(true);
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(refresh, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [secret]);

  useEffect(() => {
    if (!sessionId || secret) return;
    let active = true;
    const refresh = async () => {
      try {
        const data = await request(`/${sessionId}/lobby`);
        if (active) {
          setLobby(data);
          if (data.drawn) setMode("resume");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [secret]);

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setState(await request(`/${sessionId}/pin`, "POST", { pin }));
      setPin("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request(
        sessionId
          ? `/${sessionId}/${mode === "resume" ? "resume" : "join"}`
          : "",
        "POST",
        mode === "resume" && sessionId ? { participantId, pin } : { name, pin },
      );
      setPin("");
      setRevealed(false);
      sessionStorage.setItem(key(data.id), data.secret);
      if (!sessionId) location.assign(`/session/${data.id}`);
      else {
        setSecret(data.secret);
        setState(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: "draw" | "end") {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `/${sessionId}${kind === "draw" ? "/draw" : ""}`,
        kind === "draw" ? "POST" : "DELETE",
      );
      if (kind === "end") {
        sessionStorage.removeItem(key(sessionId!));
        location.assign("/");
      } else setState(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  async function removeParticipant() {
    if (!removeTarget) return;
    setBusy(true);
    setError("");
    try {
      setState(
        await request(`/${sessionId}/remove`, "POST", {
          participantId: removeTarget.id,
        }),
      );
      setRemoveTarget(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Kopiera länken i fältet och skicka den till dina vänner.");
    }
  }

  return (
    <div className="page">
      <header>
        <a href="/" className="brand">
          <SantaIcon /> Secret Santa
        </a>
        <span className="season">EN LITEN JULHEMLIGHET</span>
      </header>
      <main>
        <h1>
          {state?.drawn
            ? "Lite julmagi, bara för dig."
            : state
              ? "Alla samlade?"
              : sessionId
                ? lobby?.drawn
                  ? "Välkommen tillbaka."
                  : "Du är inbjuden."
                : "Vem får din julklapp?"}
        </h1>
        <p className="intro">
          {state?.drawn
            ? "Din tilldelning är klar. Nu börjar det roliga."
            : state
              ? "Bjud in dina vänner. När alla är med är det dags att dra namn."
              : sessionId
                ? lobby?.drawn
                  ? "Välj ditt namn och ange din PIN-kod."
                  : "Skriv ditt namn för att vara med."
                : "Samla alla och låt slumpen bestämma vem du ger en julklapp till."}
        </p>
        {error && (
          <div role="alert" className="alert alert-error message">
            {error}
          </div>
        )}
        {offline && (
          <div role="status" className="alert message">
            Kontakten med servern är bruten. Vi försöker igen…
          </div>
        )}
        {state?.requiresPin && (
          <section className="card panel pin-upgrade">
            <div className="card-body">
              <h2>Välj en PIN för att kunna återvända</h2>
              <form onSubmit={savePin}>
                <label htmlFor="upgrade-pin">PIN-kod (4 siffror)</label>
                <input
                  id="upgrade-pin"
                  className="input input-bordered"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(e) =>
                    setPin(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  required
                />
                <button
                  className="btn btn-primary main-button"
                  disabled={busy || pin.length !== 4}
                >
                  Spara PIN-kod
                </button>
              </form>
            </div>
          </section>
        )}
        {!state ? (
          sessionId && !lobby ? (
            <p role="status">
              {error ? "Sessionen kunde inte hämtas." : "Hämtar sessionen…"}
            </p>
          ) : (
            <section className="card panel">
              <div className="card-body">
                <div className="step">
                  {sessionId ? "VÄLKOMMEN IN" : "BÖRJA HÄR"}
                </div>
                {sessionId && lobby && !lobby.drawn && (
                  <div
                    className="entry-tabs"
                    role="group"
                    aria-label="Välj hur du vill ansluta"
                  >
                    <button
                      type="button"
                      className={`btn ${mode === "join" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => {
                        setMode("join");
                        setPin("");
                        setError("");
                      }}
                    >
                      Gå med
                    </button>
                    <button
                      type="button"
                      className={`btn ${mode === "resume" ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => {
                        setMode("resume");
                        setPin("");
                        setError("");
                      }}
                    >
                      Jag är redan med
                    </button>
                  </div>
                )}
                <h2>
                  {sessionId
                    ? mode === "resume"
                      ? "Välkommen tillbaka"
                      : "Vad heter du?"
                    : "Skapa ett julsällskap"}
                </h2>
                {sessionId && lobby && (
                  <p className="small">
                    {lobby.drawn
                      ? "Lottningen är klar. Logga in för att se ditt namn."
                      : "Med i sessionen:"}{" "}
                    {!lobby.drawn && lobby.people.map((p) => p.name).join(", ")}
                  </p>
                )}
                <form onSubmit={join}>
                  {sessionId && mode === "resume" ? (
                    <>
                      <label htmlFor="participant">Ditt namn</label>
                      <select
                        id="participant"
                        className="select select-bordered"
                        value={participantId}
                        onChange={(e) => setParticipantId(e.target.value)}
                        required
                      >
                        <option value="">Välj ditt namn</option>
                        {lobby?.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <label htmlFor="name">Ditt namn</label>
                      <input
                        id="name"
                        className="input input-bordered"
                        placeholder="Till exempel Emilia"
                        autoComplete="given-name"
                        maxLength={40}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </>
                  )}
                  <label htmlFor="pin">
                    {mode === "resume" && sessionId
                      ? "Din PIN-kod"
                      : "Välj en PIN-kod (4 siffror)"}
                  </label>
                  <input
                    id="pin"
                    className="input input-bordered"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    minLength={4}
                    maxLength={4}
                    autoComplete={
                      mode === "resume" && sessionId
                        ? "current-password"
                        : "new-password"
                    }
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    required
                    aria-describedby="pin-help"
                  />
                  <p id="pin-help" className="small">
                    Spara länken och kom ihåg din PIN. Du behöver den för att se
                    lottningen.
                  </p>
                  <button
                    className="btn btn-primary main-button"
                    disabled={
                      busy ||
                      pin.length !== 4 ||
                      (sessionId && mode === "resume"
                        ? !participantId
                        : !name.trim())
                    }
                  >
                    {busy ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : null}
                    {sessionId
                      ? mode === "resume"
                        ? "Visa min sida"
                        : "Gå med i sessionen"
                      : "Skapa inbjudningslänk"}
                  </button>
                </form>
                <p className="small">
                  {sessionId
                    ? "Din PIN-kod skyddar din privata tilldelning."
                    : "Du är också med i lottningen, såklart."}
                </p>
              </div>
            </section>
          )
        ) : state.drawn ? (
          <section className={`card panel reveal ${revealed ? "opened" : ""}`}>
            <div className="card-body">
              <div aria-hidden="true" className="gift">
                🎁
              </div>
              {revealed ? (
                <>
                  <div className="sparkles" aria-hidden="true">
                    ✦ · ✧ · ✦
                  </div>
                  <div className="step">DU ÄR SECRET SANTA TILL</div>
                  <h2 className="recipient">{state.recipient}</h2>
                  <span className="badge badge-outline private-badge">
                    Bara du ser ditt namn
                  </span>
                </>
              ) : (
                <>
                  <h2>Se till att ingen kikar över axeln.</h2>
                  <p>Och glöm inte spara någonstans säkert.</p>
                  <button
                    className="btn btn-primary main-button"
                    onClick={() => setRevealed(true)}
                  >
                    Öppna luckan
                  </button>
                </>
              )}
              <ResultExpiry expires={state.expires} />
              {revealed && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setRevealed(false)}
                >
                  Dölj namnet
                </button>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="card panel">
              <div className="card-body">
                <div className="list-header">
                  <h2>Familjen</h2>
                  <span className="badge badge-outline">
                    {state.people.length}{" "}
                    {state.people.length === 1 ? "deltagare" : "deltagare"}
                  </span>
                </div>
                <ul
                  className="participants"
                  aria-label="Deltagare i julsällskapet"
                >
                  {state.people.map((p, i) => (
                    <li
                      key={p.id}
                      className={`present present-${i % 4}`}
                      style={
                        {
                          "--drift-duration": `${18 + (i % 5) * 3}s`,
                          "--drift-delay": `${-(i % 7) * 3}s`,
                        } as React.CSSProperties
                      }
                    >
                      <span className="present-bow" aria-hidden="true" />
                      <span className="present-lid" aria-hidden="true" />
                      <div className="present-label">
                        <span className="participant-name">{p.name}</span>
                        {p.id === state.me && (
                          <span className="you">
                            du{state.isHost ? " · värd" : ""}
                          </span>
                        )}
                      </div>
                      {state.isHost && p.id !== state.me && (
                        <button
                          className="btn btn-ghost btn-sm remove-person"
                          type="button"
                          aria-label={`Ta bort ${p.name}`}
                          disabled={busy}
                          onClick={() =>
                            setRemoveTarget({ id: p.id, name: p.name })
                          }
                        >
                          Ta bort
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {removeTarget && state.isHost && (
                  <div
                    className="remove-confirm"
                    role="group"
                    aria-label="Bekräfta borttagning"
                  >
                    <p>
                      Ta bort <strong>{removeTarget.name}</strong> från
                      sessionen?
                    </p>
                    <p className="small">
                      Personens åtkomst och PIN tas bort. Personen kan gå med
                      igen och välja en ny PIN innan lottningen.
                    </p>
                    <div className="remove-actions">
                      <button
                        className="btn btn-error"
                        disabled={busy}
                        onClick={() => void removeParticipant()}
                      >
                        Ja, ta bort
                      </button>
                      <button
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => setRemoveTarget(null)}
                      >
                        Avbryt
                      </button>
                    </div>
                  </div>
                )}
                {state.isHost ? (
                  <>
                    <div className="invite">
                      <label htmlFor="link">Inbjudningslänk</label>
                      <div className="link-row">
                        <input
                          id="link"
                          className="input input-bordered"
                          readOnly
                          value={location.href}
                          onFocus={(e) => e.target.select()}
                        />
                        <button className="btn btn-neutral" onClick={copy}>
                          {copied ? "Kopierad!" : "Kopiera"}
                        </button>
                      </div>
                    </div>
                    <button
                      className="btn btn-primary main-button"
                      disabled={
                        busy ||
                        state.people.length < 2 ||
                        offline ||
                        !!removeTarget
                      }
                      onClick={() => void action("draw")}
                    >
                      Alla är med — lotta namn
                    </button>
                    <p className="small">
                      {state.people.length < 2
                        ? "Minst två personer behövs."
                        : "När du lottar stängs sessionen för nya deltagare."}
                    </p>
                  </>
                ) : (
                  <div className="waiting">
                    <span className="loading loading-dots loading-sm" /> Väntar
                    på att värden startar lottningen
                  </div>
                )}
              </div>
            </section>
          </>
        )}
        <div className="notes">
          <span>✧ Ingen får sig själv</span>
          <span>♡ Ett namn till var och en</span>
          <span>⌑ Din tilldelning är privat</span>
        </div>
        {state?.isHost && (
          <div className="end">
            {confirm ? (
              <div role="alert">
                <p>Avsluta sessionen? Alla namn och tilldelningar raderas.</p>
                <button
                  className="btn btn-error btn-sm"
                  disabled={busy}
                  onClick={() => void action("end")}
                >
                  Ja, avsluta
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirm(false)}
                >
                  Avbryt
                </button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirm(true)}
              >
                Avsluta sessionen
              </button>
            )}
          </div>
        )}
      </main>
      <footer>
        <span>
          Sessionen avslutas efter 7 dagar eller när värden avslutar den.
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
