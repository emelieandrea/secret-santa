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
};

const sessionId = location.pathname.match(/^\/session\/([\w-]+)$/)?.[1];
const key = (id: string) => `santa:${id}`;

function App() {
  const [state, setState] = useState<State | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [revealed, setRevealed] = useState(false),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState(false);

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

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request(
        sessionId ? `/${sessionId}/join` : "",
        "POST",
        { name },
      );
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
          <span aria-hidden="true">✳</span> Secret Santa
        </a>
        <span className="season">EN LITEN JULHEMLIGHET</span>
      </header>
      <main>
        <div className="eyebrow">Dela glädjen. Behåll hemligheten.</div>
        <h1>
          {state?.drawn
            ? "Lite julmagi, bara för dig."
            : state
              ? "Alla samlade?"
              : sessionId
                ? "Du är inbjuden."
                : "Vem får din julklapp?"}
        </h1>
        <p className="intro">
          {state?.drawn
            ? "Din tilldelning är klar. Nu börjar det roliga."
            : state
              ? "Bjud in dina vänner. När alla är med är det dags att dra namn."
              : sessionId
                ? "Skriv ditt namn och gå med i julens hemligaste sällskap."
                : "Samla ditt sällskap och låt slumpen bestämma vem du ger en julklapp till."}
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
        {!state ? (
          <section className="card panel">
            <div className="card-body">
              <div className="step">
                {sessionId ? "VÄLKOMMEN IN" : "BÖRJA HÄR"}
              </div>
              <h2>{sessionId ? "Vad heter du?" : "Skapa ett julsällskap"}</h2>
              <form onSubmit={join}>
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
                <button
                  className="btn btn-primary main-button"
                  disabled={busy || !name.trim()}
                >
                  {busy ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : null}
                  {sessionId ? "Gå med i sessionen" : "Skapa inbjudningslänk"}
                </button>
              </form>
              <p className="small">
                {sessionId
                  ? "Du ser de andra deltagarna när du gått med."
                  : "Du är också med i lottningen, såklart."}
              </p>
            </div>
          </section>
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
                  <p>En liten omtanke. En stor överraskning.</p>
                  <span className="badge badge-outline private-badge">
                    Bara du ser ditt namn
                  </span>
                </>
              ) : (
                <>
                  <h2>Din hemlighet väntar.</h2>
                  <p>Se till att ingen kikar över axeln.</p>
                  <button
                    className="btn btn-primary main-button"
                    onClick={() => setRevealed(true)}
                  >
                    Öppna min julhemlighet
                  </button>
                </>
              )}
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
                  <h2>Julsällskapet</h2>
                  <span className="badge badge-outline">
                    {state.people.length}{" "}
                    {state.people.length === 1 ? "deltagare" : "deltagare"}
                  </span>
                </div>
                <ul className="participants">
                  {state.people.map((p, i) => (
                    <li key={p.id}>
                      <span className={`avatar-letter color-${i % 3}`}>
                        {p.name.slice(0, 1).toLocaleUpperCase("sv")}
                      </span>
                      <span>{p.name}</span>
                      {p.id === state.me && (
                        <span className="you">
                          du{state.isHost ? " · värd" : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
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
                      disabled={busy || state.people.length < 2 || offline}
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
        Lite mindre stress. Lite mer jul.
        <span>
          Sessioner försvinner efter 6 timmar eller när värden avslutar.
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
